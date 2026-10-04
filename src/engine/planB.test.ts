/**
 * Plan B, "If they say no, try:" (src/engine/planB.ts; planner reply to Checkpoint 4, change 6; Phase 4b design, track F
 * rule 2, and the review of track F): the rules (B > 0, Helps you at least minHelpsShare of the card's, not hidden by the
 * market guard, and likelier to go through than the card by the steps' own minAcceptGain), the two tiers (the same
 * players of theirs first, then another target), the order within a tier (Overall, then the key), the final simulation
 * of a chosen trade that wasn't a finalist, the retry and its limit, the given-player cap on the boxes, and the search's
 * own Plan Bs and injury tags on synthetic leagues (their numbers on the card's basis: the Trade Analyzer's, which runs
 * the same final block). Players are public NFL names with made-up numbers; teams are placeholders.
 */
import { describe, expect, it } from "vitest";
import { tradeScore } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, tradeInternals } from "./evaluate";
import { injuryTags, tagContextOf } from "./explain";
import { addedGiven, choosePlanB, dominatedByCard, givenCapSkip, givenPlayers, planBCandidates, planBConfig, planBFor, planBPasses, type PlanBCandidate } from "./planB";
import { meetsMinChance } from "./rank";
import { runTradeSearch } from "./search";
import { TEST_NOW } from "./testLeague";
import { flat, handLeague, smallLeague, withWaiverStash } from "./trade.testing";
import type { TradeAsset, TradeEvaluation, TradeEvaluationCore } from "./tradeModel";
import { FIXTURE_B3, tradeEvaluation, type EvaluationFixture } from "./tradeTestFixtures";

/** The steps' own bar, which Plan B clears too: 5 percentage points of P_complete. */
const GAIN = config.search.steps.minAcceptGain;
/** A trade with the card's partner ("7") at the screening stage (1,000 seasons) unless told otherwise; by default likelier to go through than the card (0.6 against 0.5). */
const core = (o: EvaluationFixture): TradeEvaluation => tradeEvaluation({ stage: "exact", sims: 1000, pComplete: 0.6, ...o });
/** The card: Bo Nix for Travis Kelce, B 5 (Helps you 57), P_complete 0.5, final. */
const CARD = tradeEvaluation({ give: ["nix"], get: ["kelce"], b: 5, pComplete: 0.5 });
const cfg = planBConfig();
const player = (id: string): TradeAsset => ({ kind: "player", id });

/** Runs choosePlanB to the end, counting its yields and the simulations it asks for. */
function choose(candidates: readonly PlanBCandidate[], finals: Record<string, TradeEvaluationCore> = {}, c = cfg, skip?: (x: PlanBCandidate) => boolean) {
  const asked: string[] = [];
  let yields = 0;
  const it = choosePlanB(
    CARD,
    candidates,
    (x) => {
      asked.push(x.key);
      return finals[x.key] ?? { ...x, stage: "final", sims: 5000 };
    },
    c,
    skip,
  );
  for (;;) {
    const r = it.next();
    if (r.done) return { planB: r.value, asked, yields };
    yields++;
  }
}

describe("a box another card matches or beats (dominatedByCard; final review of Phase 4c, finding R2)", () => {
  // Parker's Team 4: the box Garrett Wilson → Tee Higgins + Mike Evans (25, 32.0%) beside the card Garrett Wilson → Chuba
  // Hubbard + Mike Evans (30, 36.1%) with the same team.
  const box = tradeEvaluation({ partnerId: "4", give: ["wilson"], get: ["higgins", "evans"], b: 1.75, pComplete: 0.32, stage: "final" });
  const better = tradeEvaluation({ partnerId: "4", give: ["wilson"], get: ["hubbard", "evans"], b: 2.15, pComplete: 0.361 });

  it("a card with the same partner at least as helpful (as printed) and at least as likely: dominated; otherwise not", () => {
    expect([box.tradeScore, better.tradeScore]).toEqual([25, 30]);
    expect(dominatedByCard(box, [better])).toBe(true);
    // Another partner's card, the box itself, a less likely card or a less helpful one: no.
    expect(dominatedByCard(box, [{ ...better, proposal: { ...better.proposal, partnerId: "5" } }])).toBe(false);
    expect(dominatedByCard(box, [box])).toBe(false);
    expect(dominatedByCard(box, [{ ...better, pComplete: 0.31 }])).toBe(false);
    expect(dominatedByCard(box, [{ ...better, tradeScore: 24 }])).toBe(false);
    // Ties count: the same Helps you and the same chance.
    expect(dominatedByCard(box, [{ ...better, key: "other", tradeScore: 25, pComplete: 0.32 }])).toBe(true);
    // Unknown numbers never dominate, nor are dominated.
    expect(dominatedByCard({ ...box, tradeScore: null }, [better])).toBe(false);
    expect(dominatedByCard(box, [{ ...better, tradeScore: null }])).toBe(false);
  });

  it("choosePlanB passes over a dominated candidate (it counts as a try) and takes the next one", () => {
    // Two candidates with the card's partner, likelier than the card and helpful enough; the first is dominated by a shown card.
    const first = core({ give: ["nix"], get: ["kelce", "x"], b: 4, pComplete: 0.6, stage: "final", sims: 5000 });
    const second = core({ give: ["nix", "y"], get: ["kelce"], b: 3.5, pComplete: 0.65, stage: "final", sims: 5000 });
    const shown = tradeEvaluation({ give: ["nix"], get: ["mcbride"], b: 4.5, pComplete: 0.62 });
    const candidates: PlanBCandidate[] = [{ core: first, kind: "samePlayers" }, { core: second, kind: "samePlayers" }];
    const run = (cards: readonly TradeEvaluationCore[]) => {
      const it = choosePlanB(CARD, candidates, (x) => x, cfg, undefined, cards);
      for (;;) {
        const r = it.next();
        if (r.done) return r.value;
      }
    };
    expect(run([])?.key).toBe(first.key);
    // The shown card (53, 62%) beats the first (49, 60%) on both, not the second (44, 65%): the second is the box.
    expect(dominatedByCard(first, [shown])).toBe(true);
    expect(dominatedByCard(second, [shown])).toBe(false);
    expect(run([shown])?.key).toBe(second.key);
    // Both beaten: no box.
    expect(run([shown, { ...shown, key: "other", pComplete: 0.66 }])).toBeNull();
  });
});

describe("config (§15)", () => {
  it("reads config.search.planB (Helps you at least half the card's, at most 3 candidates tried), the steps' acceptance bar and the given-player cap", () => {
    expect(config.search.planB).toEqual({ minHelpsShare: 0.5, tries: 3 });
    expect(GAIN).toBe(0.05);
    expect(config.ranking.perGivenPlayerInTop20).toBe(3);
    expect(planBConfig()).toEqual({ minHelpsShare: 0.5, tries: 3, minAcceptGain: 0.05, givenPlayerCap: 3 });
  });
});

describe("planBPasses: the rules", () => {
  it("needs B > 0 and Helps you at least minHelpsShare × the card's, as the cards print them", () => {
    const half = Math.ceil(0.5 * (CARD.tradeScore as number)); // 57 → 28.5 → 29
    const atB = (score: number) => -FIXTURE_B3 * Math.log(1 - (score + 0.1) / 100); // a B whose Trade Score rounds to `score` (the fixtures' B₃)
    expect(tradeScore(atB(half), FIXTURE_B3)).toBe(half);
    expect(planBPasses(core({ b: atB(half) }), CARD)).toBe(true);
    expect(planBPasses(core({ b: atB(half - 1) }), CARD)).toBe(false);
    expect(planBPasses(core({ b: 9 }), CARD)).toBe(true); // more than the card's: fine
    expect(planBPasses(core({ b: 0 }), CARD)).toBe(false);
    expect(planBPasses(core({ b: -1 }), CARD)).toBe(false);
    expect(planBPasses(core({ b: null }), CARD)).toBe(false);
    // Another share.
    expect(planBPasses(core({ b: atB(half) }), CARD, { ...cfg, minHelpsShare: 0.8 })).toBe(false);
  });

  it("never a trade hidden by the market guard, an illegal one, or against a card without a Helps you", () => {
    expect(planBPasses(core({ b: 4, gMine: config.benefit.marketHideBelow - 0.01 }), CARD)).toBe(false);
    expect(planBPasses(core({ b: 4, gMine: config.benefit.marketCheckBelow - 0.01 }), CARD)).toBe(true); // a Market check alone is fine
    expect(planBPasses(core({ b: 4, illegal: "Team 7 can have at most 4 QBs." }), CARD)).toBe(false);
    expect(planBPasses(core({ b: 4 }), { tradeScore: null, pComplete: 0.5 })).toBe(false);
  });

  it("is likelier to go through than the card, by at least the steps' minAcceptGain (review of track F: a 'try again' that's harder to land contradicted itself)", () => {
    // The card's P_complete is 0.5: a Plan B needs 0.55.
    expect(planBPasses(core({ b: 4, pComplete: 0.3 }), CARD)).toBe(false); // less likely
    expect(planBPasses(core({ b: 4, pComplete: 0.5 }), CARD)).toBe(false); // just as likely
    expect(planBPasses(core({ b: 4, pComplete: 0.549 }), CARD)).toBe(false); // under the bar
    expect(planBPasses(core({ b: 4, pComplete: 0.55 }), CARD)).toBe(true); // at the bar
    expect(planBPasses(core({ b: 4, pComplete: 0.8 }), CARD)).toBe(true);
    // The reviewer's card #1 on Parker's league: Helps you 29 at 56.3%; its first Plan B (the card plus one more of mine)
    // was 25 at 51.1%, worse on both numbers: never again.
    const card1 = tradeEvaluation({ give: ["wilson"], get: ["kelce", "laporta"], b: 2.05, pComplete: 0.563 });
    const plusOne = core({ give: ["wilson", "kyren"], get: ["kelce", "laporta"], b: 1.73, pComplete: 0.511 });
    expect([card1.tradeScore, plusOne.tradeScore]).toEqual([29, 25]);
    expect(planBPasses(plusOne, card1)).toBe(false);
    // null turns the rule off (a report switch): the planner's rules as first read.
    expect(planBPasses(core({ b: 4, pComplete: 0.3 }), CARD, { ...cfg, minAcceptGain: null })).toBe(true);
    expect(planBPasses(core({ b: 4, pComplete: 0.56 }), CARD, { ...cfg, minAcceptGain: 0.1 })).toBe(false);
  });

  it("so a Plan B meets every minimum chance its card meets (the file header: on the chance as printed, rank.ts)", () => {
    for (const m of config.ranking.minChanceOptions) {
      for (let i = 0; i <= 1000; i++) {
        const card = i / 1000;
        if (!meetsMinChance(card, m)) continue;
        // The least likely Plan B the rule lets through.
        expect(meetsMinChance(Math.min(1, card + GAIN), m), `${card} at ${m}`).toBe(true);
      }
    }
  });
});

describe("planBCandidates: same partner, the same players of theirs first, then Overall", () => {
  it("keeps other trades with the card's partner that pass, the same players of theirs first, each tier by Overall then key", () => {
    const pool = [
      CARD,
      core({ key: "other-partner", partnerId: "8", give: ["nix"], get: ["jsn"], b: 9, pComplete: 0.9 }),
      core({ key: "t-low", give: ["kyren"], get: ["jsn"], b: 4, pComplete: 0.6 }), // EG 2.4
      core({ key: "t-high", give: ["nacua"], get: ["jsn"], b: 6, pComplete: 0.6 }), // EG 3.6
      core({ key: "s-low", give: ["nix", "kyren"], get: ["kelce"], b: 3, pComplete: 0.6 }), // same players of theirs, EG 1.8
      core({ key: "s-high", give: ["wilson"], get: ["kelce"], b: 4, pComplete: 0.7 }), // EG 2.8
      core({ key: "s-tie-b", give: ["jefferson"], get: ["kelce"], b: 3, pComplete: 0.6 }), // EG 1.8: ties go to the key
      core({ key: "s-harder", give: ["bijan"], get: ["kelce"], b: 8, pComplete: 0.45 }), // EG 3.6, but less likely than the card
      core({ key: "hurts-me", give: ["allen"], get: ["kelce"], b: -1, pComplete: 0.9 }),
      core({ key: "lopsided", give: ["bijan"], get: ["jsn"], b: 8, pComplete: 0.9, gMine: -0.5 }),
    ];
    const got = planBCandidates(CARD, pool);
    expect(got.map((c) => [c.core.key, c.kind])).toEqual([
      ["s-high", "samePlayers"],
      ["s-low", "samePlayers"],
      ["s-tie-b", "samePlayers"],
      ["t-high", "otherTarget"],
      ["t-low", "otherTarget"],
    ]);
    // The order of the pool never matters, and a key counts once.
    expect(planBCandidates(CARD, [...pool].reverse()).map((c) => c.core.key)).toEqual(got.map((c) => c.core.key));
    expect(planBCandidates(CARD, [...pool, core({ key: "s-high", give: ["wilson"], get: ["kelce"], b: -5 })]).map((c) => c.core.key)).toEqual(got.map((c) => c.core.key));
    // Without the acceptance rule (the report switch) the harder one leads its tier, by Overall.
    expect(planBCandidates(CARD, pool, { ...cfg, minAcceptGain: null })[0]?.core.key).toBe("s-harder");
  });

  it("never a trade the list shows as a card, above or below this one (final review of Phase 4b: a box naming another card was circular)", () => {
    const pool = [
      CARD,
      core({ key: "s-high", give: ["wilson"], get: ["kelce"], b: 4, pComplete: 0.7 }),
      core({ key: "s-low", give: ["nix", "kyren"], get: ["kelce"], b: 3, pComplete: 0.6 }),
      core({ key: "t-high", give: ["nacua"], get: ["jsn"], b: 6, pComplete: 0.6 }),
    ];
    expect(planBCandidates(CARD, pool).map((c) => c.core.key)).toEqual(["s-high", "s-low", "t-high"]);
    // "s-high" and "t-high" are cards too: the box falls through to the next candidate.
    expect(planBCandidates(CARD, pool, cfg, ["s-high", "t-high", CARD.key]).map((c) => c.core.key)).toEqual(["s-low"]);
    expect(planBFor(CARD, pool, (c) => c, cfg, undefined, ["s-high"])).toMatchObject({ key: "s-low", kind: "samePlayers" });
    expect(planBFor(CARD, pool, (c) => c, cfg, undefined, ["s-high", "s-low", "t-high"])).toBeNull();
  });

  it("the same players of theirs means the same set I'd get, in any order; more or fewer is another target", () => {
    const card = tradeEvaluation({ give: ["nix"], get: ["kelce", "jsn"], b: 5, pComplete: 0.5 });
    const kinds = planBCandidates(card, [core({ key: "a", give: ["kyren"], get: ["jsn", "kelce"], b: 4 }), core({ key: "b", give: ["nix"], get: ["kelce"], b: 4 }), core({ key: "c", give: ["nix"], get: ["kelce", "jsn", "nacua"], b: 4 })]);
    expect(kinds.map((k) => [k.core.key, k.kind])).toEqual([
      ["a", "samePlayers"],
      ["b", "otherTarget"],
      ["c", "otherTarget"],
    ]);
  });
});

describe("choosePlanB: the final simulation and the retry", () => {
  const cand = (key: string, o: EvaluationFixture = {}, kind: PlanBCandidate["kind"] = "otherTarget"): PlanBCandidate => ({ core: core({ key, give: ["kyren"], get: ["jsn"], b: 4, ...o }), kind });

  it("takes a finalist's own numbers, without a simulation or a yield", () => {
    const finalist = cand("fin", { stage: "final", sims: 5000, b: 4.5, pComplete: 0.65 }, "samePlayers");
    const { planB, asked, yields } = choose([finalist, cand("next")]);
    expect(asked).toEqual([]);
    expect(yields).toBe(0);
    expect(planB).toEqual({
      proposal: finalist.core.proposal,
      key: "fin",
      b: 4.5,
      tradeScore: tradeScore(4.5, FIXTURE_B3),
      pAccept: 0.65,
      pComplete: 0.65,
      acceptLabel: finalist.core.acceptLabel,
      overall: finalist.core.overall,
      kind: "samePlayers",
      // Phase 4c (planner reply to Checkpoint 4b, change 7): the same evaluation's acceptance features and raw g_mkt(P).
      features: finalist.core.features,
      gPartner: finalist.core.gPartner,
      // Phase 4c (change 9, "real odds on every card"): its odds from the same final-block simulation.
      dPO: finalist.core.dPO,
      dCH: finalist.core.dCH,
    });
    // Its proposal is a copy, not the pool's object.
    expect(planB?.proposal).not.toBe(finalist.core.proposal);
  });

  it("Phase 4c (change 9): carries its odds from its own final-block simulation (ΔPO, ΔCH, win chance by week, a copy), never from numbers that aren't the final block's", () => {
    const winChance = [{ week: 9, before: 0.48, after: 0.55 }, { week: 13, before: 0.42, after: 0.51 }];
    const screened = cand("scr", { b: 4, dPO: 0.9, dCH: 0.9 });
    const final = { ...screened.core, stage: "final" as const, sims: 5000, b: 3.2, tradeScore: tradeScore(3.2, FIXTURE_B3), dPO: 0.031, dCH: 0.012, detail: { ...screened.core.detail, winChance } };
    const { planB } = choose([screened], { scr: final });
    expect(planB).toMatchObject({ key: "scr", dPO: 0.031, dCH: 0.012, winChance });
    expect(planB?.winChance).not.toBe(winChance);
    expect(planB?.winChance?.[0]).not.toBe(winChance[0]);
    // Title odds unknown: dCH null, as the card's.
    expect(choose([screened], { scr: { ...final, dCH: null } }).planB).toMatchObject({ dCH: null, dPO: 0.031 });
    // A points-only league's empty list stays empty (no weekly line).
    expect(choose([screened], { scr: { ...final, detail: { ...final.detail, winChance: [] } } }).planB?.winChance).toEqual([]);
    // Numbers that aren't the final block's (a test's finalOf handing back the screening numbers): no odds at all.
    const notFinal = planBFor(CARD, [CARD, core({ key: "x", give: ["nacua"], get: ["kelce"], b: 4, dPO: 0.05, dCH: 0.02 })], (c) => c);
    expect(notFinal).toMatchObject({ key: "x" });
    expect(notFinal && ["dPO", "dCH", "winChance"].filter((k) => k in notFinal)).toEqual([]);
  });

  it("simulates a candidate that wasn't a finalist on the final block first (yielding before), and shows those numbers", () => {
    const screened = cand("scr", { b: 4 });
    const final = { ...screened.core, stage: "final" as const, sims: 5000, b: 3.2, tradeScore: tradeScore(3.2, FIXTURE_B3) };
    const { planB, asked, yields } = choose([screened], { scr: final });
    expect(asked).toEqual(["scr"]);
    expect(yields).toBe(1);
    expect(planB).toMatchObject({ key: "scr", b: 3.2, tradeScore: tradeScore(3.2, FIXTURE_B3) });
  });

  it("passes over a candidate whose final numbers fail the rules (less help, or no longer likelier), and tries at most `tries` candidates", () => {
    const fails = (key: string) => ({ ...cand(key).core, stage: "final" as const, sims: 5000, b: -0.5, tradeScore: null, overall: null });
    const list = [cand("a"), cand("b"), cand("c"), cand("d")];
    // a fails on its final numbers, b passes.
    expect(choose(list, { a: fails("a") })).toMatchObject({ planB: { key: "b" }, asked: ["a", "b"] });
    // a's final P_complete falls under the bar: passed over too.
    expect(choose(list, { a: { ...cand("a").core, stage: "final", sims: 5000, pComplete: 0.52 } })).toMatchObject({ planB: { key: "b" }, asked: ["a", "b"] });
    // a, b and c fail: d is never tried (tries 3).
    expect(choose(list, { a: fails("a"), b: fails("b"), c: fails("c") })).toEqual({ planB: null, asked: ["a", "b", "c"], yields: 3 });
    expect(choose(list, { a: fails("a") }, { ...cfg, tries: 1 })).toEqual({ planB: null, asked: ["a"], yields: 1 });
    expect(choose([])).toEqual({ planB: null, asked: [], yields: 0 });
  });

  it("a skipped candidate (the given-player cap) is passed over without a simulation, and doesn't use up a try", () => {
    const list = [cand("a"), cand("b"), cand("c"), cand("d")];
    const skipAB = (x: PlanBCandidate) => x.core.key === "a" || x.core.key === "b";
    expect(choose(list, {}, { ...cfg, tries: 1 }, skipAB)).toEqual({ planB: expect.objectContaining({ key: "c" }), asked: ["c"], yields: 1 });
    expect(choose(list, {}, cfg, () => true)).toEqual({ planB: null, asked: [], yields: 0 });
  });

  it("planBFor runs the whole choice for one card", () => {
    const pool = [CARD, core({ key: "x", give: ["nacua"], get: ["kelce"], b: 4, stage: "final", sims: 5000 })];
    expect(planBFor(CARD, pool, (c) => c)).toMatchObject({ key: "x", kind: "samePlayers" });
    expect(planBFor(CARD, [CARD], (c) => c)).toBeNull();
    expect(planBFor(CARD, pool, (c) => c, cfg, () => true)).toBeNull();
  });
});

describe("the given-player cap on the boxes (⚠️ ours; review of track F)", () => {
  it("counts the players of mine a Plan B adds to its card's: each once, picks aside", () => {
    const card = { give: [player("wilson")] };
    expect(givenPlayers({ give: [player("wilson"), player("wilson"), { kind: "pick", season: 2027, round: 1, originalTeamId: "3" }, player("nix")] })).toEqual(["wilson", "nix"]);
    expect(addedGiven(card, { give: [player("wilson"), player("kyren")] })).toEqual(["kyren"]); // the card plus one more of mine
    expect(addedGiven(card, { give: [player("nix")] })).toEqual(["nix"]); // another package
    expect(addedGiven(card, { give: [player("wilson")] })).toEqual([]); // the same player of mine, more of theirs
  });

  it("skips a candidate that would add a player of mine already added by `cap` boxes; off without a cap", () => {
    const card = { give: [player("wilson")] };
    const plusKyren: PlanBCandidate = { core: core({ give: ["wilson", "kyren"], get: ["kelce"] }), kind: "samePlayers" };
    const plusNix: PlanBCandidate = { core: core({ give: ["wilson", "nix"], get: ["kelce"] }), kind: "samePlayers" };
    const boxes = new Map([["kyren", 3], ["nix", 2]]);
    const skip = givenCapSkip(card, boxes, 3);
    expect(skip?.(plusKyren)).toBe(true);
    expect(skip?.(plusNix)).toBe(false);
    // The card's own player never counts against it: a box that keeps Wilson adds nothing.
    expect(givenCapSkip(card, new Map([["wilson", 9]]), 3)?.(plusNix)).toBe(false);
    expect(givenCapSkip(card, boxes, null)).toBeUndefined();
  });
});

describe("the search's Plan Bs (search.ts; synthetic leagues)", { timeout: 60_000 }, () => {
  // W at the best free agent's value (withWaiverStash: Checkpoint 4c's rule, which these facts of the data were measured
  // on); A3's W, the best free agent left unclaimed, is 750 here, and leaves fewer cheap throw-ins for the boxes.
  const league = withWaiverStash(smallLeague(11));
  const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
  const result = runTradeSearch(ctx, {});
  const withPlanB = result.trades.filter((t) => t.planB);
  const planBOf = (t: TradeEvaluation) => t.planB as NonNullable<TradeEvaluation["planB"]>;

  it("gives Plan B only to cards without steps, with the card's partner, another trade, and the rules on its final numbers", () => {
    expect(withPlanB.length).toBeGreaterThan(0); // a fact of the synthetic data, deterministic
    for (const t of withPlanB) {
      const p = planBOf(t);
      expect(t.steps).toBeUndefined();
      expect(p.proposal.partnerId).toBe(t.proposal.partnerId);
      expect(p.key).not.toBe(t.key);
      expect(p.b).toBeGreaterThan(0);
      expect(p.tradeScore).toBeGreaterThanOrEqual(config.search.planB.minHelpsShare * (t.tradeScore as number) - 1e-9);
      const ids = (xs: readonly { kind: string; id?: string }[]) => xs.map((a) => a.id).sort().join(",");
      expect(p.kind === "samePlayers").toBe(ids(p.proposal.get) === ids(t.proposal.get));
    }
    for (const t of result.trades.filter((x) => x.steps)) expect(t.planB).toBeUndefined();
    // Never another card of the list (final review of Phase 4b).
    const cards = new Set(result.trades.map((t) => t.key));
    for (const t of withPlanB) expect(cards.has(planBOf(t).key), t.key).toBe(false);
  });

  it("never a fallback that's harder to land: every Plan B is likelier to go through than its card, by the steps' bar, so never worse on both numbers", () => {
    for (const t of withPlanB) expect(planBOf(t).pComplete).toBeGreaterThanOrEqual(t.pComplete + GAIN - 1e-9);
    // The planner's rules as first read (the report switch): here some were less likely than their card.
    const first = runTradeSearch(ctx, { planB: { minAcceptGain: null } });
    expect(first.trades.map((t) => t.key)).toEqual(result.trades.map((t) => t.key)); // the ranking is the same
    expect(first.trades.filter((t) => t.planB && t.planB.pComplete < t.pComplete).length).toBeGreaterThan(0); // a fact of the synthetic data
  });

  it("keeps the boxes to the given-player cap: no player of mine is added by more than perGivenPlayerInTop20 boxes of the cards in the top-20 window", () => {
    const window = result.trades.slice(0, config.ranking.partnerCapTop);
    const added = (r: typeof result) => {
      const n = new Map<string, number>();
      for (const t of r.trades.slice(0, config.ranking.partnerCapTop)) if (t.planB) for (const id of addedGiven(t.proposal, t.planB.proposal)) n.set(id, (n.get(id) ?? 0) + 1);
      return Math.max(0, ...n.values());
    };
    expect(window.length).toBe(result.trades.length);
    expect(added(result)).toBeLessThanOrEqual(config.ranking.perGivenPlayerInTop20);
    // Without the cap (the report switch) one player of mine was added again and again here, and the ranking is the same.
    const uncapped = runTradeSearch(ctx, { planB: { givenPlayerCap: null } });
    expect(uncapped.trades.map((t) => t.key)).toEqual(result.trades.map((t) => t.key));
    expect(added(uncapped)).toBeGreaterThan(config.ranking.perGivenPlayerInTop20); // a fact of the synthetic data
  });

  it("shows each Plan B's numbers on the card's basis: what the Trade Analyzer gives the same trade (the final block), never hidden by the market guard", () => {
    for (const t of withPlanB.slice(0, 4)) {
      const p = planBOf(t);
      const a = analyzeTrade(ctx, p.proposal).evaluation as TradeEvaluation;
      expect(a.key).toBe(p.key);
      expect([a.b, a.tradeScore, a.pAccept, a.pComplete, a.acceptLabel, a.overall]).toEqual([p.b, p.tradeScore, p.pAccept, p.pComplete, p.acceptLabel, p.overall]);
      // Phase 4c: the model inputs feedback stores when it's the version sent, from the same evaluation.
      expect(p.features).toEqual(a.features);
      expect(p.gPartner).toBe(a.gPartner);
      expect(a.flags.hiddenByMarket).toBe(false);
    }
  });
});

describe("the search's injury tags (flags.tagged; planner reply to Checkpoint 4, change 6, and the review of track F)", { timeout: 60_000 }, () => {
  // A hand league in week 5 (made-up players): team 2's RB ra2 is Questionable with ESPN's return in week 8 and no
  // Sleeper projection this week (his projection follows the date, as Josh Jacobs's did on Parker's league); team 3's
  // WR wa3 is Questionable with the same date but Sleeper projects him in full (the date is stale); team 3's RB rb3 is
  // Out with a date already past (week 3: the OUT table applies); team 4's WR wa4 is Out until week 7.
  const league = handLeague((spec) => {
    const edit = (team: number, id: string, change: Partial<ReturnType<typeof flat>>) => {
      const t = spec.teams[team - 1];
      if (t) t.roster = t.roster.map((p) => (p.id === id ? { ...p, ...change } : p));
    };
    edit(2, "ra2", { points: { 5: 0, 6: 14, 7: 14, 8: 14, 9: 14 }, injury: "QUESTIONABLE", injuryReturnWeek: 8 });
    edit(3, "wa3", { injury: "QUESTIONABLE", injuryReturnWeek: 8 });
    edit(3, "rb3", { injury: "OUT", injuryReturnWeek: 3 });
    edit(4, "wa4", { injury: "OUT", injuryReturnWeek: 7 });
  });
  const ctx = buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
  const I = tradeInternals(ctx);
  const result = runTradeSearch(ctx, {});

  it("keeps a return week only where the projection counts on it: a Questionable player's far date when his projection follows it, never a stale or past one", () => {
    expect(I.model.players.ra2?.availabilityNote?.used).toBe("returnDate");
    expect(I.model.players.wa3?.availabilityNote?.used).toBe("sleeper");
    const proposal = { give: [], get: ["ra2", "wa3", "rb3", "wa4"].map(player) };
    expect(injuryTags(proposal, I.snapshot.players, tagContextOf(I))).toEqual([
      { playerId: "ra2", side: "get", status: "QUESTIONABLE", returnWeek: 8 },
      { playerId: "wa3", side: "get", status: "QUESTIONABLE" },
      { playerId: "rb3", side: "get", status: "OUT" },
      { playerId: "wa4", side: "get", status: "OUT", returnWeek: 7 },
    ]);
  });

  it("tags every shown trade's injured players with the League model's word (tagContextOf), the stale and past dates left out", () => {
    for (const t of result.trades) expect(t.flags.tagged).toEqual(injuryTags(t.proposal, I.snapshot.players, tagContextOf(I)));
    const tags = result.trades.flatMap((t) => t.flags.tagged ?? []);
    expect(tags.length).toBeGreaterThan(0); // a fact of the hand league: rb3 and wa3 are in shown trades
    expect(tags.filter((x) => x.playerId === "rb3" || x.playerId === "wa3").every((x) => x.returnWeek === undefined)).toBe(true);
  });
});
