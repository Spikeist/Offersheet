/**
 * The promotion's cost (Checkpoint 7h; the lead's ruling: "check each card's Last offer alone (the Last offer doesn't depend
 * on the Open or the Thens) and work out the full ladder only for promoted cards and the cards the merge reads, so the
 * promotions are the same"; search.ts, "Promoted Last offers", the cost; offers.ts searchLastOfferSteps): on synthetic leagues
 * (trade.testing.ts smallLeague: made-up players, placeholder teams) the search as built equals the one that works out every
 * card's whole ladder (TradeSearchOptions.promoteFullLadders) in everything but what counts the ladders: its promotions, the
 * Last offers not promoted with why, the lists, merges, drops and rounds, the forced Opens and preferences; every ladder it
 * keeps is the whole-ladder search's for that card; every shown card's first open, worked out on demand, is the ladder the
 * whole-ladder search kept for it; and its Opens and Thens printing a higher Overall are the whole-ladder search's on the cards
 * whose ladder it kept. Seeds (facts of the synthetic data, found on this tree): 4, 5, 8, 24 and 57 promote (6 teams at 10%),
 * 1 has Last offers not promoted for the list's rules, 3 a 12-team league at Any; and the two guards of `lastOnly` (search.ts
 * lastOf: a card whose Last offer alone was checked counts as having its ladder fixed without a preference): on 49 the "Helps
 * both" list's card's Last offer is an Overall card checked so, and on 57 an Overall card of an earlier round, each "taken"
 * (promote's "taken" reason without `lastOnly` promotes it: the merge records differ); on 51 a later round's merge reads such a
 * card (choiceOf honoring a preference for it gives it one: the preferences differ); on 9 a card tagged "Helps both" whose
 * Last offer the tag decides. Mutations caught: those two guards (49 and 57; 51), and searchLastOfferSteps with the card's
 * "Helps both" tag left out (9).
 */
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { buildTradeContext } from "./evaluate";
import { offerLadderOfSearch } from "./offers";
import { runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeSearchResult } from "./tradeModel";

/** The partner's numbers to 12 significant digits (search.merge.test.ts ulpsInThem: Checkpoint 7f's resume), `ms` left out. */
const round = (v: unknown): unknown =>
  typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(12)) : Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
const ulpsInThem = (x: unknown): unknown => JSON.parse(JSON.stringify(x ?? null, (k, v) => (k === "ms" ? undefined : k === "them" ? round(v) : v)));
/** A result without what counts the ladders (MergedCards.ladders, lastOffers, higherEarlier) and its timings. */
function withoutLadderCounts(r: TradeSearchResult): unknown {
  const { timings: _t, ...rest } = r;
  void _t;
  if (!rest.merged) return rest;
  const { ladders: _l, lastOffers: _o, higherEarlier: _h, ...merged } = rest.merged;
  void _l;
  void _o;
  void _h;
  return { ...rest, merged };
}

function pair(seed: number, teams: number, minChance: number): { light: TradeSearchResult; full: TradeSearchResult } {
  const mk = () => {
    const league = smallLeague(seed, {}, teams);
    return buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 8 });
  };
  const settings = { ...defaultTradeSettings(), minChance };
  return { light: runTradeSearch(mk(), { settings }), full: runTradeSearch(mk(), { settings, promoteFullLadders: true }) };
}

describe("the promotion checks each card's Last offer alone (Checkpoint 7h)", { timeout: 900_000 }, () => {
  const CASES = [
    { seed: 4, teams: 6, minChance: 0.1 },
    { seed: 5, teams: 6, minChance: 0.1 },
    { seed: 8, teams: 6, minChance: 0.1 },
    { seed: 24, teams: 6, minChance: 0.1 },
    { seed: 1, teams: 6, minChance: 0.1 },
    { seed: 3, teams: 12, minChance: 0 },
    { seed: 9, teams: 6, minChance: 0.1 },
    { seed: 49, teams: 6, minChance: 0.1 },
    { seed: 51, teams: 6, minChance: 0.1 },
    { seed: 57, teams: 6, minChance: 0.1 },
  ];

  it("the same promotions, lists and merge records as working out every card's whole ladder; the same ladders kept and opened", () => {
    let promoted = 0;
    let rules = 0;
    let lastAlone = 0;
    let taken = 0;
    for (const { seed, teams, minChance } of CASES) {
      const w = `smallLeague ${seed} (${teams} teams)`;
      const { light, full } = pair(seed, teams, minChance);
      promoted += light.merged?.promoted?.length ?? 0;
      rules += (light.merged?.notPromoted ?? []).filter((n) => n.reason === "rules").length;
      taken += (light.merged?.notPromoted ?? []).filter((n) => n.reason === "taken").length;
      lastAlone += light.merged?.lastOffers ?? 0;
      // Everything but the ladder counts, bit for bit but the partner's last bits (Checkpoint 7f's resume).
      const a = withoutLadderCounts(light);
      const b = withoutLadderCounts(full);
      if (!isDeepStrictEqual(a, b)) expect(ulpsInThem(a), w).toEqual(ulpsInThem(b));
      expect(full.merged?.lastOffers, w).toBe(0);
      expect(light.merged?.ladders, w).toBeLessThan(full.merged?.ladders as number);
      const sl = searchStateOf(light) as SearchState;
      const sf = searchStateOf(full) as SearchState;
      for (const [k, ladder] of sl.ladders ?? new Map<string, OfferLadder>()) expect(ulpsInThem(ladder), `${w}: kept ${k}`).toEqual(ulpsInThem(sf.ladders?.get(k)));
      // Every promoted card's ladder is kept (its forced Open), so its first open is instant and the worker's fallback has it to equal.
      for (const p of light.merged?.promoted ?? []) expect(sl.ladders?.has(p.key), `${w}: ${p.key} kept`).toBe(true);
      const cards = [...light.trades, ...(light.helpsBoth?.trades ?? [])];
      for (const c of cards) expect(ulpsInThem(offerLadderOfSearch(light, c.key)), `${w}: first open of ${c.key}`).toEqual(ulpsInThem(sf.ladders?.get(c.key)));
      const kept = new Set(sl.ladders?.keys() ?? []);
      expect(light.merged?.higherEarlier, w).toEqual((full.merged?.higherEarlier ?? []).filter((h) => kept.has(h.card)));
    }
    // Facts of the synthetic data (so the comparison covers both the promotions and the list's rules).
    expect(promoted).toBeGreaterThanOrEqual(4);
    expect(rules).toBeGreaterThan(0);
    expect(taken).toBeGreaterThanOrEqual(2);
    expect(lastAlone).toBeGreaterThan(0);
  });
});
