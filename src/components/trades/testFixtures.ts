/**
 * Test-only: the Trade Finder's and Trade Analyzer's fixtures. The league is the League page's fictional one
 * (src/components/league/testFixtures.ts: four teams, every name made up; the user's team is "1"), and the
 * evaluations come from the engine's TradeEvaluation fixtures (src/engine/tradeTestFixtures.ts), whose numbers
 * follow the engine's own rules (Trade Score, Overall, label and flags from B and P_complete), here with this
 * league's players: by default I give Wiggleton Spoons (WR, ATL) to team 2 (Gravel Gophers) for Cornelius Snoot
 * (RB, HOU).
 *
 * Planner addendum to Checkpoint 3: GLOOP_PREMIUM is the star premium on Mortimer Gloop, team 2's most valuable player
 * and a top-12 one ("Harder to get", as the League fixture's premiums say); steppedFull() and steppedOffer() are the
 * two kinds of "Offer first / if they say no" (TradeSteps), with Tobias Thimble (TE, JAX) as my throw-in.
 */
import type { LeagueSnapshot } from "@/engine/model";
import { tradeEvaluation, type EvaluationFixture } from "@/engine/tradeTestFixtures";
import type { PremiumFact, TradeEvaluation, TradeSearchResult, TradeStep } from "@/engine/tradeModel";
import { leagueFixture } from "../league/testFixtures";

/** The fictional league (ESPN; my team "1"), optionally with another trade review setting. */
export function tradeSnapshot(over: { tradeReview?: LeagueSnapshot["settings"]["tradeReview"]; myTeamId?: string | null } = {}): LeagueSnapshot {
  const snap = leagueFixture({ myTeamId: over.myTeamId === undefined ? "1" : over.myTeamId }).snapshot;
  return over.tradeReview ? { ...snap, settings: { ...snap.settings, tradeReview: over.tradeReview } } : snap;
}

/** A final-stage evaluation in this league: Spoons to team 2 for Snoot unless told otherwise. */
export function evaluation(o: EvaluationFixture = {}): TradeEvaluation {
  return tradeEvaluation({ partnerId: "2", give: ["106"], get: ["204"], reasons: ["Your RB2 spot goes from 9.1 to 14.3 projected points per week."], pitch: "Hey! Want Wiggleton Spoons for Cornelius Snoot?", ...o });
}

/** Team 2's Mortimer Gloop: its most valuable player and a top-12 one, so "Harder to get" (e = 0.10 + 0.10). */
export const GLOOP_PREMIUM: PremiumFact = { playerId: "202", e: 0.2, rank: 1, elite: true, harderToGet: true };
/** Team 2's Cornelius Snoot: its fourth most valuable, not a top-12 one: no premium. */
export const SNOOT_PREMIUM: PremiumFact = { playerId: "204", e: 0, rank: 4, elite: false, harderToGet: false };

/** One version of a trade in "Offer first / if they say no" (TradeStep), its numbers from an evaluation of it. */
export function step(o: { give: string[]; get: string[]; pAccept: number; pComplete?: number; b?: number; vetoRisk?: boolean }): TradeStep {
  const e = evaluation({ give: o.give, get: o.get, pAccept: o.pAccept, pComplete: o.pComplete ?? o.pAccept, b: o.b ?? 3, detail: { vetoRisk: o.vetoRisk ?? false } });
  return { proposal: e.proposal, key: e.key, b: e.b, tradeScore: e.tradeScore, pAccept: e.pAccept, pComplete: e.pComplete, acceptLabel: e.acceptLabel, gMine: e.gMine, gPartner: e.gPartner, required: e.required, detail: e.detail };
}

/**
 * The ranked trade includes my throw-in (TradeSteps.ranked "full"): I give Spoons and Thimble for Snoot (an estimated
 * 55%); offer Spoons alone first (35%), and if they say no, add Thimble.
 */
export function steppedFull(o: EvaluationFixture = {}): TradeEvaluation {
  const full = step({ give: ["106", "108"], get: ["204"], pAccept: 0.55, b: 3 });
  const e = evaluation({ give: ["106", "108"], get: ["204"], pAccept: 0.55, pComplete: 0.55, ...o });
  return { ...e, steps: { offerFirst: step({ give: ["106"], get: ["204"], pAccept: 0.35, b: 3.4 }), ifNo: { add: "108", full }, ranked: "full" } };
}

/**
 * The ranked trade is the first offer (TradeSteps.ranked "offerFirst"): Spoons for Snoot (35%); if they say no, add
 * Thimble (55%), which keeps at least 80% of what the first offer does for me.
 */
export function steppedOffer(o: EvaluationFixture = {}): TradeEvaluation {
  const offer = step({ give: ["106"], get: ["204"], pAccept: 0.35, b: 3 });
  const e = evaluation({ pAccept: 0.35, pComplete: 0.35, ...o });
  return { ...e, steps: { offerFirst: offer, ifNo: { add: "108", full: step({ give: ["106", "108"], get: ["204"], pAccept: 0.55, b: 2.6 }) }, ranked: "offerFirst" } };
}

/** A search's result around some evaluations. */
export function searchResult(trades: TradeEvaluation[], over: Partial<TradeSearchResult> = {}): TradeSearchResult {
  return {
    trades,
    myTeamId: "1",
    baseline: { pPlayoffs: 0.62, pTitle: 0.09, expWins: 8.1 },
    hidden: { byBenefit: 0, byMarket: 0 },
    counts: { screened: 1234, exact: 200, simScreen: 200, simFinal: 40 },
    timings: { total: 4210 },
    notes: [],
    warnings: [],
    ...over,
  };
}
