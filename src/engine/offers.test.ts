/**
 * "How to offer it": offers in order (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1; src/engine/offers.ts): the
 * candidates (the card's give side with other get sides from the partner's get pool, the lean version, never the card; since
 * Checkpoint 7f nothing else barred, a Plan B never being an offer by the rules; another card of its list can be one: the
 * lead's call, wave D), the rules on the numbers each offer prints (Open at
 * least max(15%, the minimum chance) and at least 5 points under the card, each later offer at least 5 points likelier,
 * Helps you never rising from Open to the card nor under the card's, B falling at every step (the final review of Checkpoint
 * 7e, ENG-7E-1: on equal printed Helps you),
 * the Last offer the card plus a throw-in at least 5 points likelier keeping 80% of B, every offer helping me and passing the
 * market guard, helping both under a card tagged "Helps both"), the places (ladderRoom), the messages, the Trade Analyzer's
 * card and a card whose search isn't kept (offerLadderOfProposal), the cases that get the suggested trade alone, and
 * determinism; and Checkpoint 7f's parts for the merge (ladderNeighbors, offerFeasible, ladderChoiceSteps). Synthetic
 * leagues (trade.testing.ts smallLeague: made-up players, placeholder teams); which seeds show what is a fact of the
 * synthetic data, said where a test leans on it.
 */
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "./acceptance";
import { helpsBoth } from "./benefit";
import { config } from "./config";
import { buildTradeContext, proposalKey, quickScreen, throwIns, tradeInternals, type TradeContext } from "./evaluate";
import {
  ladderCandidates,
  ladderChoice,
  ladderChoiceSteps,
  ladderJobOfProposal,
  ladderJobOfSearch,
  ladderNeighbors,
  ladderRoom,
  offerFeasible,
  offerLadderOfProposal,
  offerLadderOfSearch,
  openBar,
  preScreened,
  proposalFromKey,
} from "./offers";
import { planBCandidates, planBConfig } from "./planB";
import { compareOverall } from "./rank";
import { mulberry32 } from "./rng";
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeAsset, TradeEvaluation, TradeProposal, TradeSearchResult } from "./tradeModel";

const at = (minChance: number, x: Partial<TradeSettings> = {}): TradeSettings => ({ ...defaultTradeSettings(), ...x, minChance });
const ids = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const chance = (e: { pComplete: number }) => displayAcceptance(e.pComplete);
const GAIN = config.search.steps.minAcceptGain;

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
function search(seed: number, minChance = 0.1): TradeSearchResult {
  const key = `${seed}|${minChance}`;
  let r = searches.get(key);
  if (!r) {
    r = runTradeSearch(contextOf(seed), { settings: at(minChance) });
    searches.set(key, r);
  }
  return r;
}
const cardsOf = (r: TradeSearchResult): TradeEvaluation[] => [...new Map([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => [t.key, t])).values()];
/** The other cards of the list or lists a result shows the card `key` on (both for a card on both). */
const listedWith = (r: TradeSearchResult, key: string): string[] => {
  const lists = [r.trades, r.helpsBoth?.trades ?? []].filter((list) => list.some((t) => t.key === key));
  return [...new Set(lists.flatMap((list) => list.map((t) => t.key)))].filter((k) => k !== key);
};

/** Every rule of the file header, on the numbers the ladder's offers print, for `card` (a search's or the Analyzer's). */
function expectRules(ladder: OfferLadder, card: TradeEvaluation, settings: TradeSettings, where: string): void {
  const steps = ladder.steps;
  expect(ladder.cardKey, where).toBe(card.key);
  expect(steps.length, where).toBeLessThanOrEqual(config.offers.maxSteps);
  const kinds = steps.map((s) => s.kind);
  // The order: Open, Thens, the suggested trade, the Last offer; no Then without an Open.
  expect(kinds.join(">"), where).toMatch(/^(open(>then)*>)?suggested(>last)?$/);
  const suggested = steps.find((s) => s.kind === "suggested");
  expect(suggested?.evaluation.key, where).toBe(card.key);
  expect(suggested?.evaluation.tradeScore, where).toBe(card.tradeScore);
  expect(suggested?.evaluation.pComplete, where).toBe(card.pComplete);
  expect(suggested?.evaluation.planB, where).toBeUndefined();
  const tagged = helpsBoth(card);
  steps.forEach((s, i) => {
    const e = s.evaluation;
    const w = `${where} ${s.kind} ${e.key}`;
    // Every offer helps me and passes the market guard; under a card tagged "Helps both" it helps both.
    expect(e.b as number, w).toBeGreaterThan(0);
    expect(e.tradeScore as number, w).toBeGreaterThan(0);
    expect(e.flags.hiddenByMarket, w).toBe(false);
    if (tagged) expect(helpsBoth(e), w).toBe(true);
    // Printed on the card's own block (the shown block's seasons).
    expect(e.sims, w).toBe(card.sims);
    // Never the card's Plan B.
    if (card.planB) expect(e.key, w).not.toBe(card.planB.key);
    // Each offer at least 5 points likelier than the one before (as printed), and ⚠️ less good for me: a B strictly below the
    // one before's, whatever Helps you prints (the final review of Checkpoint 7e, ENG-7E-1).
    if (i > 0) expect(chance(e), w).toBeGreaterThanOrEqual(chance(steps[i - 1]?.evaluation as TradeEvaluation) + GAIN - 1e-9);
    if (i > 0) expect(e.b as number, w).toBeLessThan((steps[i - 1]?.evaluation.b as number) - 1e-9);
    // Messages: the first offer's pitch, then follow-ups naming each version.
    if (i === 0) expect(s.message, w).toBe(e.pitch);
    else expect(s.message.startsWith("Thanks for considering it! Would you"), w).toBe(true);
    if (s.kind === "open") expect(chance(e), w).toBeGreaterThanOrEqual(openBar(settings.minChance) - 1e-9);
    if (s.kind === "open" || s.kind === "then") {
      // Helps you never rising from Open to the card, never under the card's.
      expect(e.tradeScore as number, w).toBeGreaterThanOrEqual(card.tradeScore as number);
      const next = steps[i + 1]?.evaluation as TradeEvaluation;
      expect(e.tradeScore as number, w).toBeGreaterThanOrEqual(next.tradeScore as number);
      // A variant (my side as the card's) or the lean version (their side as the card's, one player of mine fewer).
      const sameGive = proposalKey({ ...e.proposal, get: [] }) === proposalKey({ ...card.proposal, get: [] });
      const lean = proposalKey({ ...e.proposal, give: [] }) === proposalKey({ ...card.proposal, give: [] }) && ids(e.proposal.give).length === ids(card.proposal.give).length - 1;
      expect(sameGive || lean, w).toBe(true);
    }
    if (s.kind === "last") {
      // ⚠️ Never a higher Helps you than the card's, as printed (the review of wave D, D-ENG-4: it would be a better card),
      // nor a B as high (ENG-7E-1, above).
      expect(e.tradeScore as number, w).toBeLessThanOrEqual(card.tradeScore as number);
      expect(e.b as number, w).toBeLessThan((card.b as number) - 1e-9);
      // The card plus one player of mine, keeping 80% of its B.
      expect(ids(e.proposal.get).sort(), w).toEqual(ids(card.proposal.get).sort());
      const added = ids(e.proposal.give).filter((id) => !ids(card.proposal.give).includes(id));
      expect(added, w).toHaveLength(1);
      expect(ids(e.proposal.give), w).toHaveLength(ids(card.proposal.give).length + 1);
      expect(e.b as number, w).toBeGreaterThanOrEqual(config.search.steps.minBShare * (card.b as number) - 1e-9);
    }
  });
}

describe("proposalFromKey: the trade a key names", () => {
  it("reads back proposalKey's form; null for a key that isn't one, or names a pick", () => {
    const p: TradeProposal = { partnerId: "4", give: [{ kind: "player", id: "espn:12" }, { kind: "player", id: "3001" }], get: [{ kind: "player", id: "KC" }] };
    const key = proposalKey(p);
    const back = proposalFromKey(key) as TradeProposal;
    expect(proposalKey(back)).toBe(key);
    expect(ids(back.give)).toEqual(["3001", "espn:12"]);
    expect(proposalFromKey("4|give:|get:9")).toEqual({ partnerId: "4", give: [], get: [{ kind: "player", id: "9" }] });
    expect(proposalFromKey("nonsense")).toBeNull();
    expect(proposalFromKey("4|give:pick:2027:1:4|get:9")).toBeNull();
  });
});

describe("ladderRoom: at most config.offers.maxSteps offers, the suggested trade counted", () => {
  it("Open first, then the Last offer, then as many Thens as fit; no Then without an Open", () => {
    expect(config.offers.maxSteps).toBe(4);
    expect(config.offers.openMinChance).toBe(0.15);
    expect(ladderRoom(4, true, true)).toEqual({ open: true, last: true, thens: 1 });
    expect(ladderRoom(4, true, false)).toEqual({ open: true, last: false, thens: 2 });
    expect(ladderRoom(4, false, true)).toEqual({ open: false, last: true, thens: 0 });
    expect(ladderRoom(4, false, false)).toEqual({ open: false, last: false, thens: 0 });
    expect(ladderRoom(2, true, true)).toEqual({ open: true, last: false, thens: 0 });
    expect(ladderRoom(1, true, true)).toEqual({ open: false, last: false, thens: 0 });
  });

  it("the Open's bar: config.offers.openMinChance, or the user's minimum chance when that's higher", () => {
    expect(openBar(0)).toBe(0.15);
    expect(openBar(0.1)).toBe(0.15);
    expect(openBar(0.3)).toBe(0.3);
  });
});

describe("the candidates (ladderCandidates)", { timeout: 120_000 }, () => {
  it("the card's give side with every other get side of 1 to maxPerSide players from its partner's get pool; the lean version; never the card", () => {
    const r = search(1);
    const st = searchStateOf(r) as SearchState;
    for (const card of cardsOf(r)) {
      const job = ladderJobOfSearch(st, card);
      const pool = st.getPools.get(card.proposal.partnerId);
      expect(pool, card.key).toBeDefined();
      const candidates = ladderCandidates(job);
      const keys = candidates.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).not.toContain(card.key);
      const H = [...new Set([...(pool?.pool ?? []), ...ids(card.proposal.get)])];
      const variants = candidates.filter((c) => c.kind === "variant");
      for (const c of variants) {
        expect(ids(c.proposal.give)).toEqual(ids(card.proposal.give));
        const get = ids(c.proposal.get);
        expect(get.length).toBeGreaterThanOrEqual(1);
        expect(get.length).toBeLessThanOrEqual(st.settings.maxPerSide);
        for (const id of get) expect(H).toContain(id);
      }
      // Every such set but the card's own (nothing else barred since Checkpoint 7f): C(H, 1) + … + C(H, maxPerSide), less one.
      const choose = (n: number, k: number): number => (k === 0 ? 1 : (n * choose(n - 1, k - 1)) / k);
      let all = 0;
      for (let k = 1; k <= st.settings.maxPerSide; k++) all += choose(H.length, k);
      expect(variants.length).toBe(all - 1);
      // The lean version: without my lowest-value throw-in in the trade, whenever my side keeps a player.
      const mine = throwIns(st.I, st.settings).filter((id) => ids(card.proposal.give).includes(id));
      const lean = candidates.filter((c) => c.kind === "lean");
      expect(lean.length, card.key).toBe(mine.length > 0 && ids(card.proposal.give).length >= 2 ? 1 : 0);
      for (const c of lean) {
        expect(ids(c.proposal.get)).toEqual(ids(card.proposal.get));
        expect(ids(c.proposal.give)).toEqual(ids(card.proposal.give).filter((id) => id !== mine[0]));
      }
    }
  });
});

describe("the rules on the numbers each offer prints (every card of whole searches)", { timeout: 300_000 }, () => {
  it("hold for every card, and the ladders show every kind of offer (seeds 1, 3, 9: facts of the synthetic data)", () => {
    const kinds = new Set<string>();
    for (const seed of [1, 3, 9]) {
      const r = search(seed);
      for (const card of cardsOf(r)) {
        const ladder = offerLadderOfSearch(r, card.key) as OfferLadder;
        expect(ladder, `${seed} ${card.key}`).not.toBeNull();
        expectRules(ladder, card, at(0.1), `seed ${seed}`);
        for (const s of ladder.steps) kinds.add(s.kind);
      }
    }
    expect([...kinds].sort()).toEqual(["last", "open", "suggested", "then"]);
  });

  it("each offer was chosen on the screening block and holds on the printed numbers; its words are its own (its reasons and pitch, its roster moves)", () => {
    const r = search(3);
    const st = searchStateOf(r) as SearchState;
    let checked = 0;
    for (const card of cardsOf(r)) {
      const ladder = offerLadderOfSearch(r, card.key) as OfferLadder;
      for (const s of ladder.steps.filter((x) => x.kind !== "suggested")) {
        const v = st.versions.get(s.evaluation.key);
        expect(v, s.evaluation.key).toBeDefined();
        // The chance doesn't depend on the seasons; Helps you does.
        expect(v?.screen.pComplete).toBe(s.evaluation.pComplete);
        expect(s.evaluation.sims).toBe(config.simulation.shownSims);
        expect(v?.screen.sims).toBe(config.simulation.screeningSims);
        expect(s.evaluation.myMoves).toBeDefined();
        expect(s.evaluation.pitch.length).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the Open prints at least the user's minimum chance when that's above 15% (a re-filter's cards read their own minimum)", () => {
    const r = search(1);
    const st = searchStateOf(r) as SearchState;
    const re = runRefilter(contextOf(1), st, { minChance: 0.3 });
    expect(re.trades.length).toBeGreaterThan(0);
    for (const card of cardsOf(re)) {
      const ladder = offerLadderOfSearch(re, card.key) as OfferLadder;
      expectRules(ladder, card, at(0.3), "minimum 30%");
      const open = ladder.steps.find((s) => s.kind === "open");
      if (open) expect(chance(open.evaluation)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });
});

describe("⚠️ on equal printed Helps you, B decides (the final review of Checkpoint 7e, ENG-7E-1)", { timeout: 300_000 }, () => {
  it("smallLeague(32) at Any, the context's own scenarios: a card and its version without a throw-in that costs me nothing print the same Helps you at the same B; neither is the other's offer (on HEAD 24e244b the bigger one opened with the smaller, and the smaller ended with the bigger)", () => {
    const league = smallLeague(32);
    const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW });
    const r = runTradeSearch(ctx, { settings: at(0) });
    const cards = new Map(cardsOf(r).map((t) => [t.key, t]));
    // Facts of the synthetic data: both are cards of the list, the same partner, the throw-in (1002) costing me nothing.
    const lean = cards.get("4|give:1003|get:1039");
    const full = cards.get("4|give:1002,1003|get:1039");
    if (!lean || !full) throw new Error("smallLeague(32) at Any no longer shows both cards: find another pair");
    expect(lean.tradeScore).toBe(full.tradeScore);
    expect(Math.abs((lean.b as number) - (full.b as number))).toBeLessThan(1e-9);
    expect(chance(lean)).toBeLessThan(chance(full));
    const keysOf = (card: TradeEvaluation) => (offerLadderOfSearch(r, card.key) as OfferLadder).steps.map((s) => s.evaluation.key);
    expect(keysOf(full)).toEqual([full.key]);
    expect(keysOf(lean)).toEqual([lean.key]);
    // Every rule, the B order among them, on every card of the search.
    for (const card of cards.values()) expectRules(offerLadderOfSearch(r, card.key) as OfferLadder, card, at(0), "smallLeague(32) at Any");
  });
});

describe("never the card's Plan B, by the rules (nothing barred since Checkpoint 7f); another card of its list can be an offer (the lead's call, wave D)", { timeout: 300_000 }, () => {
  it("⚠️ a box can never be an offer under the default config (a property): it prints a chance at least its card's, where an Open or Then prints one at least minAcceptGain under it, and it's another set of their players, where the lean version and the Last offer keep the card's", () => {
    const cfg = planBConfig();
    expect(cfg.minAcceptGain).toBe(GAIN);
    expect(GAIN).toBeGreaterThan(0);
    expect(cfg.otherTargetOnly).toBe(true);
    const rand = mulberry32(20261015);
    for (let i = 0; i < 20_000; i++) {
      // Any card and any box planBPasses lets through: a P_complete at least GAIN above the card's.
      const card = rand() * 0.95;
      const box = Math.min(1, card + GAIN + rand() * (1 - card));
      const w = `card ${card} box ${box}`;
      expect(chance({ pComplete: box }), w).toBeGreaterThanOrEqual(chance({ pComplete: card }) - 1e-9);
      expect(chance({ pComplete: box }) <= chance({ pComplete: card }) - GAIN + 1e-9, w).toBe(false);
    }
    // And every box candidate of whole searches is another set of their players (planBCandidates under the default config).
    for (const seed of [1, 3]) {
      const st = searchStateOf(search(seed)) as SearchState;
      for (const card of st.finals) {
        for (const c of planBCandidates(card, st.planBPool, cfg)) {
          expect(c.kind).toBe("otherTarget");
          expect([...ids(c.core.proposal.get)].sort()).not.toEqual([...ids(card.proposal.get)].sort());
        }
      }
    }
  });

  it("no offer is the card's Plan B, nor would be with every candidate played out (seeds 1, 3, 9, every card)", () => {
    let boxes = 0;
    for (const seed of [1, 3, 9]) {
      const r = search(seed);
      const st = searchStateOf(r) as SearchState;
      for (const card of cardsOf(r)) {
        if (!card.planB) continue;
        boxes++;
        const ladder = offerLadderOfSearch(r, card.key) as OfferLadder;
        for (const s of ladder.steps) expect(s.evaluation.key, `${seed} ${card.key} ${s.kind}`).not.toBe(card.planB.key);
        const every = ladderChoice(ladderJobOfSearch(st, card), { every: true });
        expect([every?.open?.candidate.key, ...(every?.thens ?? []).map((t) => t.candidate.key), every?.last?.printed.key], `${seed} ${card.key}`).not.toContain(card.planB.key);
      }
    }
    expect(boxes).toBeGreaterThan(0);
  });

  it("offers that are another card of its list occur, each holding every rule, printing that card's own numbers and, since Checkpoint 7f, above it on Overall (the merge folds one below it: search.merge.test.ts) (seeds 1, 3, 9: a fact of the synthetic data)", () => {
    let others = 0;
    for (const seed of [1, 3, 9]) {
      const r = search(seed);
      const st = searchStateOf(r) as SearchState;
      const cards = new Map(cardsOf(r).map((t) => [t.key, t]));
      for (const card of cards.values()) {
        const listed = new Set(listedWith(r, card.key));
        const ladder = offerLadderOfSearch(r, card.key) as OfferLadder;
        // Every rule holds on the ladder, whatever its offers are (an Open or Then a candidate like any other: expectRules).
        expectRules(ladder, card, at(0.1), `seed ${seed}`);
        const candidates = new Set(ladderCandidates(ladderJobOfSearch(st, card)).map((c) => c.key));
        for (const s of ladder.steps) {
          if (s.kind === "suggested" || !listed.has(s.evaluation.key)) continue;
          others++;
          expect(compareOverall(cards.get(s.evaluation.key) as TradeEvaluation, card), `${seed} ${card.key} ${s.kind}`).toBeLessThan(0);
          if (s.kind === "open" || s.kind === "then") expect(candidates.has(s.evaluation.key), `${seed} ${card.key} ${s.kind}`).toBe(true);
          // The other card's own printed numbers (the same trade on the same block: the ladder reads the search's).
          const other = cards.get(s.evaluation.key) as TradeEvaluation;
          expect(s.evaluation.tradeScore, `${seed} ${card.key} ${s.kind}`).toBe(other.tradeScore);
          expect(s.evaluation.pComplete).toBe(other.pComplete);
          expect(s.evaluation.b).toBe(other.b);
        }
      }
    }
    expect(others).toBeGreaterThan(0);
  });
});

describe("the pre-screen (preScreened; the review of wave D, D-ENG-1 and D-ENG-7)", { timeout: 300_000 }, () => {
  it("plays out only candidates whose quick chance is near the Open's and Then's window, the most my lineup gains first, at most preScreenMax; every one with `every`", () => {
    expect([config.offers.preScreenMargin, config.offers.preScreenMax]).toEqual([0.1, 24]);
    const r = search(3);
    const st = searchStateOf(r) as SearchState;
    let fewer = 0;
    for (const card of cardsOf(r)) {
      const job = ladderJobOfSearch(st, card);
      const all = ladderCandidates(job);
      const kept = preScreened(job, all);
      expect(kept.length).toBeLessThanOrEqual(config.offers.preScreenMax);
      const keys = new Set(all.map((c) => c.key));
      for (const c of kept) expect(keys.has(c.key)).toBe(true);
      const partner = st.I.byId.get(card.proposal.partnerId);
      if (!partner) throw new Error("the card's partner");
      const own = quickScreen(st.I, partner, ids(card.proposal.give), ids(card.proposal.get));
      const low = openBar(st.settings.minChance) - config.offers.preScreenMargin;
      const high = (own ? own.pComplete : card.pComplete) - GAIN + config.offers.preScreenMargin;
      const gains = kept.map((c) => {
        const q = quickScreen(st.I, partner, ids(c.proposal.give), ids(c.proposal.get));
        expect(q, c.key).not.toBeNull();
        expect(q?.pComplete as number).toBeGreaterThanOrEqual(low - 1e-9);
        expect(q?.pComplete as number).toBeLessThanOrEqual(high + 1e-9);
        return q?.myDelta as number;
      });
      for (let i = 1; i < gains.length; i++) expect(gains[i] as number).toBeLessThanOrEqual((gains[i - 1] as number) + 1e-9);
      if (kept.length < all.length) fewer++;
      // `every`: all of them (a report's switch).
      const every = ladderChoice(job, { every: true });
      expect(every?.candidates).toBe(all.length);
      expect(every?.screened.length ?? 0).toBeGreaterThanOrEqual(ladderChoice(job)?.screened.length ?? 0);
    }
    expect(fewer).toBeGreaterThan(0);
  });

  it("a card's offers don't depend on which cards were opened before it (the same filter for every candidate, known or not)", () => {
    const one = runTradeSearch(contextOf(1), { settings: at(0.1) });
    const two = runTradeSearch(contextOf(1), { settings: at(0.1) });
    const cards = cardsOf(one);
    const forward = cards.map((c) => offerLadderOfSearch(one, c.key));
    const backward = [...cards].reverse().map((c) => offerLadderOfSearch(two, c.key)).reverse();
    expect(backward).toEqual(forward);
  });
});

describe("on demand: the Trade Analyzer's card, and a card whose search isn't kept (offerLadderOfProposal)", { timeout: 300_000 }, () => {
  it("hold the same rules; the Analyzer's card reads the settings it's given; a Finder card's barred keys are ignored (an older page's request, Checkpoint 7f)", () => {
    const r = search(1);
    const ctx = contextOf(1);
    let shown = 0;
    for (const card of cardsOf(r).slice(0, 6)) {
      const ladder = offerLadderOfProposal(ctx, card.proposal, { settings: at(0.1) });
      const job = ladderJobOfProposal(ctx, card.proposal, { settings: at(0.1) });
      // A Finder card whose search isn't kept: whatever keys an older page bars, the ladder is the one without them.
      const planB = card.planB ? [card.planB.key] : [];
      const finder = { settings: at(0.1), page: "finder" as const };
      expect(offerLadderOfProposal(ctx, card.proposal, { ...finder, barred: [...planB, card.key] })).toEqual(offerLadderOfProposal(ctx, card.proposal, finder));
      expect(job?.legalMax).toBe(config.search.analyzerMaxPerSide);
      expectRules(ladder, { ...(job?.card as TradeEvaluation), planB: undefined }, at(0.1), `analysis ${card.key}`);
      if (ladder.steps.length > 1) shown++;
      // The page "finder" (a card whose search isn't kept): the search's per-side limit.
      expect(ladderJobOfProposal(ctx, card.proposal, { settings: at(0.1), page: "finder" })?.legalMax).toBe(at(0.1).maxPerSide);
    }
    expect(shown).toBeGreaterThan(0);
  });

  it("no ladder for a trade that can't be evaluated: the card's key and no offers", () => {
    const ctx = contextOf(1);
    const I = tradeInternals(ctx);
    const mine = I.me?.roster[0] as string;
    const bad: TradeProposal = { partnerId: I.me?.id as string, give: [{ kind: "player", id: mine }], get: [] };
    expect(offerLadderOfProposal(ctx, bad)).toEqual({ cardKey: proposalKey(bad), steps: [] });
  });
});

describe("the suggested trade alone", { timeout: 300_000 }, () => {
  it("a trade that doesn't help me: no offers but the trade itself, its message its pitch", () => {
    const ctx = contextOf(1);
    const I = tradeInternals(ctx);
    const r = search(1);
    const card = r.trades[0] as TradeEvaluation;
    // My most valuable player for nothing: it costs me.
    const best = [...(I.me?.roster ?? [])].sort((a, b) => (I.values[b] ?? 0) - (I.values[a] ?? 0))[0] as string;
    const gift: TradeProposal = { partnerId: card.proposal.partnerId, give: [{ kind: "player", id: best }], get: [] };
    const job = ladderJobOfProposal(ctx, gift, { settings: at(0.1) });
    expect(job?.card.b as number).toBeLessThanOrEqual(0);
    expect(ladderChoice(job as NonNullable<typeof job>)).toBeNull();
    const ladder = offerLadderOfProposal(ctx, gift, { settings: at(0.1) });
    expect(ladder.steps.map((s) => s.kind)).toEqual(["suggested"]);
    expect(ladder.steps[0]?.message).toBe(ladder.steps[0]?.evaluation.pitch);
  });
});

describe("determinism and the store", { timeout: 300_000 }, () => {
  it("the same card gives the same ladder: again from the kept numbers, from a fresh search, and with a clock (its time apart)", () => {
    const r = search(9);
    const card = r.trades[0] as TradeEvaluation;
    const first = offerLadderOfSearch(r, card.key) as OfferLadder;
    const again = offerLadderOfSearch(r, card.key) as OfferLadder;
    expect(again).toEqual(first);
    const fresh = runTradeSearch(contextOf(9), { settings: at(0.1) });
    expect(offerLadderOfSearch(fresh, card.key)).toEqual(first);
    let t = 0;
    const timed = offerLadderOfSearch(r, card.key, { clock: () => (t += 5) }) as OfferLadder;
    expect(timed.ms).toBe(5);
    const { ms: _ms, ...rest } = timed;
    void _ms;
    expect(rest).toEqual(first);
  });

  it("no ladder for a card the result doesn't hold, or a result no search returned", () => {
    const r = search(9);
    expect(offerLadderOfSearch(r, "nope|give:|get:")).toBeNull();
    expect(offerLadderOfSearch({ ...r }, (r.trades[0] as TradeEvaluation).key)).toBeNull();
  });
});

describe("Checkpoint 7f: which ladders the merge works out (ladderNeighbors, offerFeasible) and in steps (ladderChoiceSteps)", { timeout: 300_000 }, () => {
  /** A search without the merge (Checkpoint 7e's lists), where cards offer other cards of their list more often. */
  const unmerged = new Map<number, TradeSearchResult>();
  const before = (seed: number): TradeSearchResult => {
    let r = unmerged.get(seed);
    if (!r) {
      r = runTradeSearch(contextOf(seed), { settings: at(0.1), mergeCards: false });
      unmerged.set(seed, r);
    }
    return r;
  };

  it("every card of its list a ladder holds is one of its ladderNeighbors, of the kind of its place, and passes offerFeasible on both cards' printed numbers (seeds 1, 3, 9, 48: a superset and a necessary condition)", () => {
    let held = 0;
    let neighbors = 0;
    for (const seed of [1, 3, 9, 48]) {
      const r = before(seed);
      const st = searchStateOf(r) as SearchState;
      for (const list of [r.trades, r.helpsBoth?.trades ?? []]) {
        const byKey = new Map(list.map((t) => [t.key, t]));
        for (const card of list) {
          const near = new Map(ladderNeighbors(st, card, list).map((n) => [n.key, n.kind]));
          expect(near.has(card.key)).toBe(false);
          neighbors += near.size;
          for (const s of (offerLadderOfSearch(r, card.key) as OfferLadder).steps) {
            const other = byKey.get(s.evaluation.key);
            if (s.kind === "suggested" || !other) continue;
            held++;
            const kind = s.kind === "last" ? "last" : "earlier";
            const w = `${seed} ${card.key} ${s.kind} ${other.key}`;
            expect(near.get(other.key), w).toBe(kind);
            expect(offerFeasible(card, other, kind, at(0.1).minChance), w).toBe(true);
          }
        }
      }
    }
    expect(held).toBeGreaterThan(0);
    expect(neighbors).toBeGreaterThan(held);
  });

  it("offerFeasible reads the rules on the printed numbers: an earlier offer's window, a Last offer's, every offer's own rules", () => {
    // A card with room on both sides of its chance (a fact of the synthetic data).
    const k = cardsOf(search(1)).find((t) => t.pComplete > 0.3 && t.pComplete < 0.7 && (t.tradeScore as number) > 2) as TradeEvaluation;
    expect(k).toBeDefined();
    const b = k.b as number;
    const like = (x: Partial<TradeEvaluation>): TradeEvaluation => ({ ...k, ...x });
    const pk = k.pComplete;
    // An Open or Then: a higher Helps you and B, a chance at least the Open's bar and GAIN under the card's.
    const open = like({ b: b * 1.5, tradeScore: (k.tradeScore as number) + 5, pComplete: pk - GAIN - 0.01 });
    expect(offerFeasible(k, open, "earlier", 0.1)).toBe(true);
    expect(offerFeasible(k, { ...open, b }, "earlier", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...open, tradeScore: (k.tradeScore as number) - 1 }, "earlier", 0.1)).toBe(false);
    expect(offerFeasible(k, open, "last", 0.1)).toBe(false);
    // The Open's bar is the user's minimum chance when that's higher.
    expect(offerFeasible(k, open, "earlier", pk)).toBe(false);
    expect(offerFeasible(k, like({ b: b * 1.5, pComplete: pk + 0.1 }), "earlier", 0.1)).toBe(false);
    expect(offerFeasible(k, like({ b: b * 1.5, pComplete: 0.05 }), "earlier", 0.1)).toBe(false);
    // A Last offer: likelier by GAIN, B under the card's but at least minBShare of it, Helps you at most the card's.
    const last = like({ b: b * 0.9, tradeScore: k.tradeScore, pComplete: Math.min(0.85, pk + GAIN + 0.01) });
    expect(offerFeasible(k, last, "last", 0.1)).toBe(true);
    expect(offerFeasible(k, { ...last, b: b * (config.search.steps.minBShare - 0.05) }, "last", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...last, b }, "last", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...last, tradeScore: (k.tradeScore as number) + 1 }, "last", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...last, pComplete: pk }, "last", 0.1)).toBe(false);
    // Every offer's own rules: legal, helping me, not hidden by the market guard.
    expect(offerFeasible(k, { ...last, illegal: "no" }, "last", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...last, b: -1 }, "last", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...last, flags: { ...last.flags, hiddenByMarket: true } }, "last", 0.1)).toBe(false);
  });

  it("ladderChoiceSteps gives ladderChoice's choices, and each step makes at most one new exact evaluation or run on the printed block (seed 3, every card, on a store of its own)", () => {
    let steps = 0;
    const fresh = runTradeSearch(contextOf(3), { settings: at(0.1), mergeCards: false });
    const st = searchStateOf(fresh) as SearchState;
    for (const card of cardsOf(fresh)) {
      const job = ladderJobOfSearch(st, card);
      const made = () => job.store.versions.size + job.store.printed.size;
      const it = ladderChoiceSteps(job);
      let last = made();
      let r = it.next();
      expect(made() - last, card.key).toBeLessThanOrEqual(1);
      last = made();
      while (!r.done) {
        steps++;
        r = it.next();
        expect(made() - last, card.key).toBeLessThanOrEqual(1);
        last = made();
      }
      expect(r.value, card.key).toEqual(ladderChoice(ladderJobOfSearch(searchStateOf(before(3)) as SearchState, card)));
    }
    expect(steps).toBeGreaterThan(0);
  });
});
