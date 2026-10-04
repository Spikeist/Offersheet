import { describe, expect, it } from "vitest";
import { acceptanceLabel } from "./acceptance";
import { overallScore, tradeScore } from "./benefit";
import { config } from "./config";
import { FIXTURE_B3, fixtureKey, premiumFact, tradeEvaluation, tradeStep, tradeSteps, withSteps } from "./tradeTestFixtures";

describe("premiumFact", () => {
  it("follows config.acceptance.starPremium: e = e_rank + e_elite, tagged 'Harder to get' from harderToGetMin", () => {
    const sp = config.acceptance.starPremium;
    expect(premiumFact("x")).toEqual({ playerId: "x", e: sp.rank[0], rank: 1, elite: false, harderToGet: false });
    expect(premiumFact("x", { rank: 2 }).e).toBeCloseTo(sp.rank[1] as number, 12);
    expect(premiumFact("x", { rank: 3 }).e).toBe(0);
    expect(premiumFact("x", { rank: 7, elite: true })).toMatchObject({ e: sp.elite, harderToGet: false });
    expect(premiumFact("x", { rank: 1, elite: true })).toMatchObject({ e: 0.2, harderToGet: true });
    // A top-12 player who is his team's #2: e = 0.15, the tag (the planner's "top-12 and #1 or #2").
    expect(premiumFact("x", { rank: 2, elite: true }).harderToGet).toBe(true);
    // An explicit e (the dynasty rebuilding halving) sets the tag too, unless it's given.
    expect(premiumFact("x", { rank: 1, elite: true, e: 0.1 })).toMatchObject({ e: 0.1, harderToGet: false });
    expect(premiumFact("x", { rank: 3, harderToGet: true }).harderToGet).toBe(true);
  });
});

describe("tradeStep", () => {
  it("follows the engine's rules, as tradeEvaluation does", () => {
    const s = tradeStep({ b: 5, pComplete: 0.3, gMine: 0.25 });
    expect(s.tradeScore).toBe(tradeScore(5, FIXTURE_B3));
    expect(s.pAccept).toBe(0.3);
    expect(s.acceptLabel).toBe(acceptanceLabel(0.3));
    expect(s.gPartner).toBeCloseTo(1 / 1.25 - 1, 12);
    expect(s.key).toBe(fixtureKey(s.proposal));
    expect(s.proposal.give).toEqual([{ kind: "player", id: "nix" }]);
    expect(s.required).toEqual({ me: { drops: [], adds: [] }, partner: { drops: [], adds: [] } });
    expect(s.detail.premium).toBeUndefined();
  });
});

describe("tradeSteps and withSteps", () => {
  const { minAcceptGain, minOfferFirst, minBShare } = config.search.steps;

  it("ranked 'full' when the throw-in is in the trade: the offer first leaves him out, the full step is the ranked trade", () => {
    const ranked = tradeEvaluation({ give: ["kelce", "nix"], get: ["bijan"] });
    const steps = tradeSteps(ranked, "nix");
    expect(steps.ranked).toBe("full");
    expect(steps.ifNo.add).toBe("nix");
    expect(steps.offerFirst.proposal).toEqual({ partnerId: ranked.proposal.partnerId, give: [{ kind: "player", id: "kelce" }], get: ranked.proposal.get });
    expect(steps.offerFirst.key).toBe(fixtureKey(steps.offerFirst.proposal));
    expect(steps.ifNo.full).toMatchObject({ proposal: ranked.proposal, key: ranked.key, b: ranked.b, tradeScore: ranked.tradeScore, pAccept: ranked.pAccept, pComplete: ranked.pComplete, acceptLabel: ranked.acceptLabel, gMine: ranked.gMine, gPartner: ranked.gPartner });
    expect(steps.ifNo.full.detail).toEqual(ranked.detail);
    // By default the steps would be shown (the addendum's thresholds).
    expect(steps.ifNo.full.pComplete - steps.offerFirst.pComplete).toBeGreaterThanOrEqual(minAcceptGain);
    expect(steps.offerFirst.pComplete).toBeGreaterThanOrEqual(minOfferFirst);
  });

  it("ranked 'offerFirst' otherwise: the offer first is the ranked trade, the full step adds the throw-in", () => {
    const ranked = tradeEvaluation({ give: ["kelce"], get: ["bijan"] });
    const e = withSteps(ranked, "nix");
    expect(e.steps.ranked).toBe("offerFirst");
    expect(e.steps.offerFirst).toMatchObject({ proposal: ranked.proposal, key: ranked.key, b: ranked.b, pComplete: ranked.pComplete, gPartner: ranked.gPartner });
    expect(e.steps.ifNo.full.proposal.give).toEqual([{ kind: "player", id: "kelce" }, { kind: "player", id: "nix" }]);
    expect(e.steps.ifNo.full.b).toBeGreaterThanOrEqual(minBShare * (ranked.b as number));
    expect(e.steps.ifNo.full.pComplete - e.steps.offerFirst.pComplete).toBeGreaterThanOrEqual(minAcceptGain);
    // The ranked trade itself is unchanged.
    expect({ ...e, steps: undefined }).toEqual({ ...ranked, steps: undefined });
  });

  it("takes overrides: derived numbers follow them, partial details merge onto the ranked trade's", () => {
    const ranked = tradeEvaluation({ give: ["kelce", "nix"], get: ["bijan"], detail: { holesFilled: ["QB1"] } });
    const steps = tradeSteps(ranked, "nix", { offerFirst: { b: 6, pComplete: 0.2, gMine: 0.25, detail: { holesFilled: ["TE1"] } }, full: { pComplete: 0.5 } });
    expect(steps.offerFirst).toMatchObject({ b: 6, tradeScore: tradeScore(6, FIXTURE_B3), pAccept: 0.2, acceptLabel: acceptanceLabel(0.2) });
    expect(steps.offerFirst.gPartner).toBeCloseTo(1 / 1.25 - 1, 12);
    expect(steps.offerFirst.detail.holesFilled).toEqual(["TE1"]);
    expect(steps.offerFirst.detail.teams).toBe(ranked.detail.teams);
    expect(steps.ifNo.full).toMatchObject({ pComplete: 0.5, pAccept: 0.5, acceptLabel: acceptanceLabel(0.5), b: ranked.b, tradeScore: ranked.tradeScore });
    expect(steps.ifNo.full.detail.holesFilled).toEqual(["QB1"]);
  });

  it("throws when the throw-in is my only player in the trade (neither case applies)", () => {
    expect(() => tradeSteps(tradeEvaluation({ give: ["nix"], get: ["kelce"] }), "nix")).toThrow(/only player/);
  });

  it("tradeEvaluation carries steps and premium facts through, and has neither by default", () => {
    const steps = tradeSteps(tradeEvaluation(), "wilson");
    const e = tradeEvaluation({ steps, detail: { premium: [premiumFact("kelce")] } });
    expect(e.steps).toBe(steps);
    expect(e.detail.premium).toEqual([premiumFact("kelce")]);
    expect("steps" in tradeEvaluation()).toBe(false);
    expect("premium" in tradeEvaluation().detail).toBe(false);
  });
});

describe("tradeEvaluation's “Helps you” scale (planner reply to Checkpoint 4c, A2)", () => {
  it("scores B on FIXTURE_B3 by default, or on the b3 a test gives", () => {
    expect(FIXTURE_B3).toBe(6);
    expect(tradeEvaluation({ b: 3 })).toMatchObject({ b3: 6, tradeScore: 39, overall: overallScore(3, 0.4, 6) });
    expect(tradeEvaluation({ b: 3, b3: 3 })).toMatchObject({ b3: 3, tradeScore: 63, overall: overallScore(3, 0.4, 3) });
    // No scale: no scores.
    expect(tradeEvaluation({ b: 3, b3: null })).toMatchObject({ b3: null, tradeScore: null, overall: null });
  });
});
