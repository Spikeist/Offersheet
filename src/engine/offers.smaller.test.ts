/**
 * The Last offer's smaller ask (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(a): "The Last offer can be either the
 * throw-in or a smaller ask, whichever has the higher Overall. It must be at least 5 points likelier and keep at least 80% of the
 * suggested trade's Overall."; offers.ts, "The candidates" and "4. Last offer"): the smaller asks (offers.ts smallerAsks), the
 * rule on made-up numbers (offerFeasible "smaller" at the bar, each other rule failing alone, higherOverall's tie), every card's
 * Last offer on whole searches (its shape, its rules on the numbers it prints, the higher Overall of the two kinds, both ways),
 * ladderNeighbors' "smaller" kind, and Plan B's narrow rule (a box is never a smaller ask its card's Last offer could take; one
 * it can't take can stay a box). Synthetic leagues (trade.testing.ts smallLeague: made-up players, placeholder teams); which
 * seeds show what is a fact of the synthetic data, said where a test leans on it (found on this tree: smallLeague 24, 25 and 56
 * at 10% merge through a smaller-ask Last offer, 12-team 1 at Any too; since the final review, 48, whose idea 3 takes its smaller
 * ask over a passing throw-in, and 41, where the narrow rule acts).
 */
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "./acceptance";
import { config } from "./config";
import { buildTradeContext, proposalKey, type TradeContext } from "./evaluate";
import {
  higherOverall,
  ladderChoice,
  ladderJobOfSearch,
  ladderNeighbors,
  offerFeasible,
  offerLadderOfSearch,
  overallOf,
  overallShareOk,
  smallerAsks,
  type LadderJob,
  type LastOfferChoice,
} from "./offers";
import { smallerAskOf } from "./planB";
import { runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
const chance = (e: { pComplete: number }) => displayAcceptance(e.pComplete);
const GAIN = config.search.steps.minAcceptGain;
const SHARE = config.offers.lastMinOverallShare;
const ids = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const player = (id: string): TradeAsset => ({ kind: "player", id });

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
const searches = new Map<string, TradeSearchResult>();
function search(seed: number, teams: number, minChance: number, extra: { mergeCards?: boolean; smallerAsks?: boolean } = {}): TradeSearchResult {
  const key = `${seed}|${teams}|${minChance}|${JSON.stringify(extra)}`;
  let r = searches.get(key);
  if (!r) {
    r = runTradeSearch(contextOf(seed, teams), { settings: at(minChance), ...extra });
    searches.set(key, r);
  }
  return r;
}
const cardsOf = (r: TradeSearchResult): TradeEvaluation[] => [...new Map([...r.trades, ...(r.helpsBoth?.trades ?? [])].map((t) => [t.key, t])).values()];

/** A made-up card for smallerAsks (its key and proposal, and the partner's must-include players). */
function fakeJob(give: string[], get: string[], forcedGet: string[] = []): Pick<LadderJob, "card" | "forcedGet"> {
  const proposal: TradeProposal = { partnerId: "4", give: give.map(player), get: get.map(player) };
  return { card: { key: proposalKey(proposal), proposal } as TradeEvaluation, forcedGet };
}

describe("smallerAsks: the card's players of mine for each proper, non-empty part of its players of theirs", () => {
  it("every such part, the larger first, in the card's order; never the card; none for a one-player get side; the partner's must-include players kept; players only", () => {
    const three = smallerAsks(fakeJob(["m1", "m2"], ["t1", "t2", "t3"]));
    expect(three.map((c) => ids(c.proposal.get))).toEqual([["t1", "t2"], ["t1", "t3"], ["t2", "t3"], ["t1"], ["t2"], ["t3"]]);
    for (const c of three) {
      expect(ids(c.proposal.give)).toEqual(["m1", "m2"]);
      expect(c.proposal.partnerId).toBe("4");
      expect(c.key).toBe(proposalKey(c.proposal));
      expect(c.kind).toBe("variant");
    }
    expect(new Set(three.map((c) => c.key)).size).toBe(6);
    expect(smallerAsks(fakeJob(["m1"], ["t1"]))).toEqual([]);
    expect(smallerAsks(fakeJob(["m1"], ["t1", "t2"])).map((c) => ids(c.proposal.get))).toEqual([["t1"], ["t2"]]);
    // A must-include player of theirs the card holds is in every one.
    expect(smallerAsks(fakeJob(["m1"], ["t1", "t2", "t3"], ["t2", "x9"])).map((c) => ids(c.proposal.get))).toEqual([["t1", "t2"], ["t2", "t3"], ["t2"]]);
    // A pick anywhere: none (the search never offers one).
    const pick = { kind: "pick", season: 2027, round: 1, originalTeamId: "4" } as TradeAsset;
    const job = fakeJob(["m1"], ["t1", "t2"]);
    expect(smallerAsks({ ...job, card: { ...job.card, proposal: { ...job.card.proposal, get: [...job.card.proposal.get, pick] } } })).toEqual([]);
  });

  it("planB.ts smallerAskOf reads the same relation: the same partner and players of mine, a proper part of theirs", () => {
    const card: TradeProposal = { partnerId: "4", give: [player("m1"), player("m2")], get: [player("t1"), player("t2")] };
    for (const c of smallerAsks(fakeJob(["m2", "m1"], ["t1", "t2"]))) expect(smallerAskOf(card, c.proposal)).toBe(true);
    expect(smallerAskOf(card, card)).toBe(false);
    expect(smallerAskOf(card, { ...card, get: [player("t3")] })).toBe(false);
    expect(smallerAskOf(card, { ...card, give: [player("m1")], get: [player("t1")] })).toBe(false);
    expect(smallerAskOf(card, { ...card, partnerId: "5", get: [player("t1")] })).toBe(false);
    expect(smallerAskOf(card, { ...card, get: [] })).toBe(false);
  });
});

describe("the rule on made-up numbers", { timeout: 300_000 }, () => {
  it("offerFeasible \"smaller\": likelier by minAcceptGain, a lower B, Helps you at most the card's, and an unrounded Overall at least lastMinOverallShare of the card's (just under: no; at it: yes)", () => {
    expect(SHARE).toBe(0.8);
    // A card with room above its chance (a fact of the synthetic data).
    const k = cardsOf(search(24, 6, 0.1)).find((t) => t.pComplete < 0.6 && (t.tradeScore as number) > 10) as TradeEvaluation;
    expect(k).toBeDefined();
    const kOverall = overallOf(k) as number;
    // A version likelier by more than GAIN whose B gives it exactly `share` of the card's Overall (Overall = 100 × (1 − e^(−B P / B₃))).
    const p = Math.min(0.85, k.pComplete + GAIN + 0.05);
    const bFor = (share: number) => (-Math.log(1 - (share * kOverall) / 100) * (k.b3 as number)) / p;
    const version = (share: number): TradeEvaluation => ({ ...k, b: bFor(share), pComplete: p, tradeScore: 1, overall: Math.round(share * kOverall) });
    expect(overallOf(version(SHARE)) as number).toBeCloseTo(SHARE * kOverall, 9);
    expect(offerFeasible(k, version(SHARE), "smaller", 0.1)).toBe(true);
    expect(offerFeasible(k, version(SHARE - 0.0001), "smaller", 0.1)).toBe(false);
    expect(overallShareOk(version(0.7999), k)).toBe(false);
    expect(overallShareOk(version(0.75), k, 0.75)).toBe(true);
    // The other rules, each failing alone. Not likelier enough: the card's own chance, with B made for 90% of its Overall at that
    // chance, so the share, B and Helps you rules pass and only the chance fails (the final review, merge-a-test-higher-overall-
    // unpinned: the version at its old chance and B kept 73% of the Overall, under the share too). A B as high as the card's. A
    // higher Helps you.
    const sameChance: TradeEvaluation = { ...k, b: (-Math.log(1 - (0.9 * kOverall) / 100) * (k.b3 as number)) / k.pComplete, pComplete: k.pComplete, tradeScore: 1 };
    expect(overallShareOk(sameChance, k)).toBe(true);
    expect((sameChance.b as number) < (k.b as number)).toBe(true);
    expect(offerFeasible(k, sameChance, "smaller", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...sameChance, pComplete: p }, "smaller", 0.1)).toBe(true);
    expect(offerFeasible(k, { ...version(0.9), b: k.b }, "smaller", 0.1)).toBe(false);
    expect(offerFeasible(k, { ...version(0.9), tradeScore: (k.tradeScore as number) + 1 }, "smaller", 0.1)).toBe(false);
    // The throw-in's rule is B's, not the Overall's: a version at 81% of the Overall with B under 80% of the card's isn't one.
    const lowB = version(0.81);
    expect((lowB.b as number) < config.search.steps.minBShare * (k.b as number)).toBe(true);
    expect(offerFeasible(k, lowB, "last", 0.1)).toBe(false);
    expect(offerFeasible(k, lowB, "smaller", 0.1)).toBe(true);
  });

  it("higherOverall: the higher Overall (EG on the printed numbers) of the two kinds; a tie goes to the throw-in; either alone", () => {
    const k = cardsOf(search(24, 6, 0.1))[0] as TradeEvaluationCore;
    const choice = (kind: "throwIn" | "smaller", b: number, p: number): LastOfferChoice =>
      kind === "throwIn" ? { kind, add: "x", proposal: k.proposal, printed: { ...k, b, pComplete: p } } : { kind, proposal: k.proposal, printed: { ...k, b, pComplete: p } };
    const t = choice("throwIn", 2, 0.5);
    expect(higherOverall(t, choice("smaller", 2.1, 0.5))?.kind).toBe("smaller");
    expect(higherOverall(t, choice("smaller", 1, 1))?.kind).toBe("throwIn");
    expect(higherOverall(t, choice("smaller", 1.9, 0.5))?.kind).toBe("throwIn");
    expect(higherOverall(t, null)).toBe(t);
    const s = choice("smaller", 1, 0.5);
    expect(higherOverall(null, s)).toBe(s);
    expect(higherOverall(null, null)).toBeNull();
  });
});

/**
 * The leagues whose Last offers include smaller asks (found on this tree), at their minimum chance; since the final review also
 * smallLeague 48, whose idea 3 takes a smaller ask over a passing throw-in with a lower Overall (merge-a-test-higher-overall-
 * unpinned), and 41, where Plan B's narrow rule acts (merge-a-test-narrow-rule-unpinned).
 */
const LEAGUES = [
  { seed: 24, teams: 6, minChance: 0.1 },
  { seed: 25, teams: 6, minChance: 0.1 },
  { seed: 56, teams: 6, minChance: 0.1 },
  { seed: 1, teams: 12, minChance: 0 },
  { seed: 48, teams: 6, minChance: 0.1 },
  { seed: 41, teams: 6, minChance: 0.1 },
] as const;

/** EG (B × P_complete): the order of the printed Overall on one block. */
const egOf = (e: { b: number | null; pComplete: number }) => (e.b as number) * e.pComplete;

describe("every card's Last offer on whole searches", { timeout: 900_000 }, () => {
  it("is the card plus one player of mine or a smaller ask, holding its kind's rules on the numbers it prints; whichever kind has the higher Overall (smallLeague 24, 25, 56, 48 and 41 at 10%, 12-team 1 at Any)", () => {
    let smaller = 0;
    let throwIn = 0;
    let bothKinds = 0;
    for (const lg of LEAGUES) {
      const r = search(lg.seed, lg.teams, lg.minChance);
      const st = searchStateOf(r) as SearchState;
      for (const card of cardsOf(r)) {
        const ladder = offerLadderOfSearch(r, card.key) as OfferLadder;
        const last = ladder.steps.find((s) => s.kind === "last");
        if (!last) continue;
        const e = last.evaluation;
        const w = `${lg.seed} ${card.key} → ${e.key}`;
        // Every Last offer: likelier by GAIN, a lower B, Helps you at most the card's.
        expect(chance(e), w).toBeGreaterThanOrEqual(chance(card) + GAIN - 1e-9);
        expect(e.b as number, w).toBeLessThan((card.b as number) - 1e-9);
        expect(e.tradeScore as number, w).toBeLessThanOrEqual(card.tradeScore as number);
        // Its own kind's share, and (a card without a preference: search.prefer.test.ts has those) how it compares with the
        // throw-in alone, the same job without smaller asks.
        const job = ladderJobOfSearch(st, card, st.prefers?.get(card.key));
        const alone = job.prefer ? undefined : (ladderChoice({ ...job, smallerAsks: false })?.last ?? null);
        if (smallerAskOf(card.proposal, e.proposal)) {
          smaller++;
          expect(overallOf(e) as number, w).toBeGreaterThanOrEqual(SHARE * (overallOf(card) as number) - 1e-9);
          if (alone) {
            bothKinds++;
            expect(egOf(e), w).toBeGreaterThan(egOf(alone.printed));
          }
        } else {
          throwIn++;
          expect(ids(e.proposal.get).sort(), w).toEqual(ids(card.proposal.get).sort());
          expect(ids(e.proposal.give).length, w).toBe(ids(card.proposal.give).length + 1);
          expect(e.b as number, w).toBeGreaterThanOrEqual(config.search.steps.minBShare * (card.b as number) - 1e-9);
          // A throw-in is the Last offer only when no smaller ask has a higher Overall: the throw-in alone's, and the smaller
          // asks' own pick (the same job with no room for a throw-in, my side held to the card's: at 2 a side a throw-in card
          // gives one player, so its smaller asks stay legal) prints an Overall at most its own (a tie goes to the throw-in).
          if (alone !== undefined) {
            expect(alone?.printed.key, w).toBe(e.key);
            const ask = ladderChoice({ ...job, legalMax: ids(card.proposal.give).length })?.last ?? null;
            if (ask?.kind === "smaller") {
              bothKinds++;
              expect(egOf(ask.printed), w).toBeLessThanOrEqual(egOf(e) + 1e-9);
            }
          }
        }
      }
    }
    // Both kinds occur, and cards where both pass, each way (facts of the synthetic data: smallLeague 48's idea 3, whose smaller
    // ask beats its throw-in, and smallLeague 24's 2|give:1002|get:1015,1018, whose throw-in beats its smaller ask).
    expect(smaller).toBeGreaterThan(0);
    expect(throwIn).toBeGreaterThan(0);
    expect(bothKinds).toBeGreaterThanOrEqual(2);
  });

  it("with the switch off (TradeSearchOptions.smallerAsks false) every Last offer is a throw-in, as at Checkpoint 7f", () => {
    const r = search(24, 6, 0.1, { smallerAsks: false });
    let lasts = 0;
    for (const card of cardsOf(r)) {
      const last = (offerLadderOfSearch(r, card.key) as OfferLadder).steps.find((s) => s.kind === "last");
      if (!last) continue;
      lasts++;
      expect(smallerAskOf(card.proposal, last.evaluation.proposal), card.key).toBe(false);
    }
    expect(lasts).toBeGreaterThan(0);
  });

  it("ladderNeighbors lists a card's smaller asks among the cards of its list as \"smaller\" (and \"earlier\": they're variants too), and offerFeasible \"smaller\" holds for the ones its ladder holds (the lists without the merge, where cards offer other cards)", () => {
    let held = 0;
    for (const lg of LEAGUES) {
      const r = search(lg.seed, lg.teams, lg.minChance, { mergeCards: false });
      const st = searchStateOf(r) as SearchState;
      for (const list of [r.trades, r.helpsBoth?.trades ?? []]) {
        const byKey = new Map(list.map((t) => [t.key, t]));
        for (const card of list) {
          const kinds = new Map<string, Set<string>>();
          for (const n of ladderNeighbors(st, card, list)) kinds.set(n.key, new Set([...(kinds.get(n.key) ?? []), n.kind]));
          for (const other of list) {
            if (other.key === card.key || !smallerAskOf(card.proposal, other.proposal)) continue;
            expect(kinds.get(other.key), `${lg.seed} ${card.key} ${other.key}`).toEqual(new Set(["smaller", "earlier"]));
          }
          for (const s of (offerLadderOfSearch(r, card.key) as OfferLadder).steps) {
            const other = byKey.get(s.evaluation.key);
            if (s.kind !== "last" || !other || !smallerAskOf(card.proposal, other.proposal)) continue;
            held++;
            expect(offerFeasible(card, other, "smaller", lg.minChance), `${lg.seed} ${card.key} ${other.key}`).toBe(true);
          }
        }
      }
    }
    expect(held).toBeGreaterThan(0); // a card's smaller-ask Last offer that is a card of its list (facts of the synthetic data)
  });
});

describe("Plan B's narrow rule (the lead's D5)", { timeout: 900_000 }, () => {
  it("no box is a smaller ask its card's Last offer could take, on the numbers both print; smallLeague 41 shows the rule act, 24 keeps a box it can't take (Team 6: about 73% of its card's Overall)", () => {
    let boxes = 0;
    let smallerBoxes = 0;
    for (const lg of LEAGUES) {
      const r = search(lg.seed, lg.teams, lg.minChance);
      const st = searchStateOf(r) as SearchState;
      for (const card of cardsOf(r)) {
        if (!card.planB) continue;
        boxes++;
        const box = st.shownByKey.get(card.planB.key) as TradeEvaluationCore;
        expect(box, card.planB.key).toBeDefined();
        if (!smallerAskOf(card.proposal, box.proposal)) continue;
        smallerBoxes++;
        expect(offerFeasible(card, box, "smaller", lg.minChance), `${lg.seed} ${card.key} box ${box.key}`).toBe(false);
      }
    }
    expect(boxes).toBeGreaterThan(0);
    expect(smallerBoxes).toBeGreaterThan(0); // smallLeague 24's Team 6 card (a fact of the synthetic data)
    const r = search(24, 6, 0.1);
    const card = cardsOf(r).find((t) => t.key === "6|give:1011|get:1065,1067") as TradeEvaluation;
    expect(card?.planB?.key).toBe("6|give:1011|get:1065");
    const box = (searchStateOf(r) as SearchState).shownByKey.get("6|give:1011|get:1065") as TradeEvaluationCore;
    expect((overallOf(box) as number) / (overallOf(card) as number)).toBeLessThan(SHARE);
    // smallLeague 41 (10%), where the rule acts (the final review, merge-a-test-narrow-rule-unpinned; a fact of the synthetic
    // data): card 4|give:1001,1004|get:1039,1040's best Plan B candidate is its smaller ask 4|give:1001,1004|get:1040, its Last
    // offer, so without the rule the card would show that one trade twice, as its Last offer and as its box.
    const r41 = search(41, 6, 0.1);
    const card41 = cardsOf(r41).find((t) => t.key === "4|give:1001,1004|get:1039,1040") as TradeEvaluation;
    expect(card41).toBeDefined();
    const last41 = (offerLadderOfSearch(r41, card41.key) as OfferLadder).steps.find((s) => s.kind === "last");
    expect(last41?.evaluation.key).toBe("4|give:1001,1004|get:1040");
    expect(card41.planB?.key).not.toBe(last41?.evaluation.key);
  });

  it("with smaller asks off (TradeSearchOptions.smallerAsks false, which turns the narrow rule off with them, as at Checkpoint 7f) a box can be a smaller ask that a Last offer could take on the numbers both print (smallLeague 24 at 10%)", () => {
    let barred = 0;
    const off = search(24, 6, 0.1, { smallerAsks: false });
    for (const card of cardsOf(off)) {
      const box = card.planB && (searchStateOf(off) as SearchState).shownByKey.get(card.planB.key);
      if (box && smallerAskOf(card.proposal, box.proposal) && offerFeasible(card, box, "smaller", 0.1)) barred++;
    }
    expect(barred).toBeGreaterThan(0);
  });
});
