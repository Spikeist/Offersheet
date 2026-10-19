/**
 * Dropped versions (Checkpoint 7g; planner reply to Checkpoint 7f, answer 3(c): "Drop a version when another version of the same
 * trade is at least as good on both Helps you and the chance."; the lead's D15–D18; search.ts dominatedOf and the merge's rounds):
 * dominatedOf on made-up cards (versions of the same trade by rank.ts versionsOfSameTrade, the filler rule's relation; the
 * printed numbers, the chance's "<5%" under every step it prints since the final review, E1; a tie by Overall order; merged
 * trades beat but are never dropped; a chain dropped for the version that stays; the versions given back exempt), then whole
 * searches: no card of a list is beaten by another version on it, every dropped version's `by` is on its list (a card, or a trade
 * merged into one) and beats it, the counts (dropped.dominated, qualifying), Plan B reads them as cards, a dropped card's merged
 * trade comes back (smallLeague 48: the release rule, the lead's D18, since the final review's E2 in the very round of the drop),
 * the lists at "Any" where "<5%" meets "5%" (smallLeague 72 and 19: E1), a dropped version's `by` that leaves (smallLeague 48,
 * a one-partner search of Team 2, and 29's chain at "Any": E2), and the switch. Synthetic leagues (trade.testing.ts smallLeague:
 * made-up players, placeholder teams); which seeds drop what is a fact of the synthetic data, found on this tree.
 */
import { describe, expect, it } from "vitest";
import { printedAcceptance } from "./acceptance";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { offerLadderOfSearch } from "./offers";
import { dominatedByCard } from "./planB";
import { compareOverall, versionsOfSameTrade } from "./rank";
import { dominatedOf, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeAsset, TradeEvaluation, TradeSearchResult } from "./tradeModel";

const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });
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
function search(seed: number, teams: number, minChance: number, extra: { dropDominated?: boolean; mergeCards?: boolean; partnerId?: string } = {}): TradeSearchResult {
  const key = `${seed}|${teams}|${minChance}|${JSON.stringify(extra)}`;
  let r = searches.get(key);
  if (!r) {
    r = runTradeSearch(contextOf(seed, teams), { settings: at(minChance), ...extra });
    searches.set(key, r);
  }
  return r;
}

/** A made-up card: its partner and players, its Helps you, P_complete and B (Overall order: EG = B × P, then the key). */
function card(give: string[], get: string[], helps: number, p: number, b = helps / 10, partner = "4"): TradeEvaluation {
  const key = `${partner}|give:${[...give].sort().join(",")}|get:${[...get].sort().join(",")}`;
  return { key, proposal: { partnerId: partner, give: give.map(player), get: get.map(player) }, tradeScore: helps, pComplete: p, b } as unknown as TradeEvaluation;
}

describe("dominatedOf (made-up cards, as printed)", () => {
  it("a version of the same trade at least as good on both Helps you and the chance drops the other; not a version, or better on one only, never", () => {
    const big = card(["m1", "m2"], ["t1"], 45, 0.55);
    const lean = card(["m1"], ["t1"], 44, 0.5, 4.6);
    expect(dominatedOf([big, lean], [])).toEqual([{ key: lean.key, by: big.key }]);
    // The chance as printed (the nearest 5%): 0.524 prints 50%, as the lean card's 0.5.
    expect(dominatedOf([card(["m1", "m2"], ["t1"], 45, 0.524), lean], [])).toEqual([{ key: lean.key, by: card(["m1", "m2"], ["t1"], 45, 0.524).key }]);
    // Better on one, worse on the other: both stay.
    expect(dominatedOf([card(["m1", "m2"], ["t1"], 43, 0.6), lean], [])).toEqual([]);
    // Not a version (another player of theirs, another partner): both stay.
    expect(dominatedOf([card(["m1", "m2"], ["t2"], 50, 0.6), lean], [])).toEqual([]);
    expect(dominatedOf([card(["m1", "m2"], ["t1"], 50, 0.6, 5, "5"), lean], [])).toEqual([]);
    expect(versionsOfSameTrade(big, lean)).toBe(true);
    expect(versionsOfSameTrade(lean, big)).toBe(true);
    expect(versionsOfSameTrade(big, big)).toBe(false);
  });

  it("equal on both printed numbers: the one lower in Overall order leaves, whichever is bigger", () => {
    const a = card(["m1"], ["t1"], 40, 0.5, 4);
    const b = card(["m1", "m2"], ["t1"], 40, 0.51, 3.9);
    // EG: a 2.0, b 1.989: a is higher in Overall order, so b leaves for a.
    expect(compareOverall(a, b)).toBeLessThan(0);
    expect(dominatedOf([a, b], [])).toEqual([{ key: b.key, by: a.key }]);
    expect(dominatedOf([b, a], [])).toEqual([{ key: b.key, by: a.key }]);
  });

  it("a trade merged into a card can beat a card, and is never dropped; a chain drops each for the version that stays", () => {
    const merged = card(["m1", "m2"], ["t1"], 45, 0.55);
    const lean = card(["m1"], ["t1"], 44, 0.5);
    expect(dominatedOf([lean], [merged])).toEqual([{ key: lean.key, by: merged.key }]);
    expect(dominatedOf([], [lean, merged])).toEqual([]);
    // c ⊂ b ⊂ a, a ≥ b ≥ c on both: b and c both drop for a (a card that stays), never c for b.
    const a = card(["m1", "m2", "m3"], ["t1"], 50, 0.6);
    const b = card(["m1", "m2"], ["t1"], 48, 0.55);
    const c = card(["m1"], ["t1"], 46, 0.5);
    expect(new Set(dominatedOf([c, b, a], []).map((x) => `${x.key} > ${x.by}`))).toEqual(new Set([`${b.key} > ${a.key}`, `${c.key} > ${a.key}`]));
    // A drop's `by` stays even when the order of Overall puts the dropped one first: b has a higher EG than a here.
    const a2 = card(["m1", "m2"], ["t1"], 50, 0.5, 4);
    const b2 = card(["m1"], ["t1"], 49, 0.5, 4.5);
    expect(compareOverall(b2, a2)).toBeLessThan(0);
    expect(dominatedOf([b2, a2], [])).toEqual([{ key: b2.key, by: a2.key }]);
  });

  it("the chance as printed: \"<5%\" counts under every step a card prints, so it ties only with \"<5%\" (the final review, E1)", () => {
    // A version printing "<5%" (P 0.04) with a higher Helps you, and one printing "5%" (P 0.06): neither is at least as good on
    // both, so both stay, whichever is the bigger trade and whichever comes first. (Read as the nearest 5%, "<5%" tied with
    // "5%", and the "5%" one, the likelier, left for the "<5%" one: smallLeague 72 at "Any", below.)
    for (const [under, five] of [
      [card(["m1"], ["t1"], 55, 0.04), card(["m1", "m2"], ["t1"], 50, 0.06)],
      [card(["m1", "m2"], ["t1"], 55, 0.04), card(["m1"], ["t1"], 50, 0.06)],
    ] as const) {
      expect(dominatedOf([under, five], [])).toEqual([]);
      expect(dominatedOf([five, under], [])).toEqual([]);
    }
    // The "5%" one at least as good on Helps you: the "<5%" one leaves for it, both ways round, though the "<5%" one is higher in
    // Overall order here (a tie on the chance would have dropped the "5%" one; and decided after it, the "5%" one couldn't drop it).
    const fiveSame = card(["m1", "m2"], ["t1"], 55, 0.06, 1);
    const underHigher = card(["m1"], ["t1"], 55, 0.049, 2);
    expect(compareOverall(underHigher, fiveSame)).toBeLessThan(0);
    expect(dominatedOf([fiveSame, underHigher], [])).toEqual([{ key: underHigher.key, by: fiveSame.key }]);
    expect(dominatedOf([underHigher, fiveSame], [])).toEqual([{ key: underHigher.key, by: fiveSame.key }]);
    // "<5%" against "<5%" (P 0.001 and 0.049 both print "<5%"): the same printed chance, so Helps you decides, and on an equal
    // Helps you the one lower in Overall order leaves.
    const lowP = card(["m1", "m2"], ["t1"], 55, 0.001);
    const highP = card(["m1"], ["t1"], 50, 0.049);
    expect(dominatedOf([lowP, highP], [])).toEqual([{ key: highP.key, by: lowP.key }]);
    const lowSame = card(["m1", "m2"], ["t1"], 50, 0.001, 500);
    expect(compareOverall(lowSame, highP)).toBeLessThan(0);
    expect(dominatedOf([highP, lowSame], [])).toEqual([{ key: highP.key, by: lowSame.key }]);
    expect(printedAcceptance(0.049)).toBe(0);
    expect(printedAcceptance(0.05)).toBe(0.05);
    expect(printedAcceptance(0.074)).toBe(0.05);
  });

  it("a version given back (exempt) is never dropped, though it can still drop another (the final review, E2)", () => {
    const a = card(["m1", "m2", "m3"], ["t1"], 50, 0.6);
    const b = card(["m1", "m2"], ["t1"], 48, 0.55);
    const c = card(["m1"], ["t1"], 46, 0.5);
    expect(dominatedOf([a, b, c], [], new Set([b.key]))).toEqual([{ key: c.key, by: a.key }]);
    // b exempt and a gone: b drops c.
    expect(dominatedOf([b, c], [], new Set([b.key]))).toEqual([{ key: c.key, by: b.key }]);
    expect(dominatedOf([b, c], [], new Set([c.key]))).toEqual([]);
  });
});

/**
 * The leagues with dropped versions (found on this tree), at their minimum chance; since the final review also smallLeague 48
 * searched with Team 2 alone (E2's case; it drops a version for a trade merged into a card, which no all-teams league of these
 * does on this tree).
 */
const LEAGUES: { seed: number; teams: number; minChance: number; partnerId?: string }[] = [
  { seed: 9, teams: 6, minChance: 0.1 },
  { seed: 26, teams: 6, minChance: 0.1 },
  { seed: 29, teams: 6, minChance: 0.1 },
  { seed: 48, teams: 6, minChance: 0.1 },
  { seed: 57, teams: 6, minChance: 0.1 },
  { seed: 7, teams: 12, minChance: 0 },
  { seed: 48, teams: 6, minChance: 0.1, partnerId: "2" },
];
const searchOf = (lg: (typeof LEAGUES)[number], extra: { dropDominated?: boolean; mergeCards?: boolean } = {}): TradeSearchResult => search(lg.seed, lg.teams, lg.minChance, { ...extra, ...(lg.partnerId ? { partnerId: lg.partnerId } : {}) });
const nameOf = (lg: (typeof LEAGUES)[number]) => `${lg.seed}${lg.partnerId ? ` (Team ${lg.partnerId})` : ""}${lg.minChance === 0 ? " at Any" : ""}`;

/** At least as good on both Helps you and the chance as printed ("<5%" under every step: acceptance.printedAcceptance), and the rule's tie by Overall order. */
const asGood = (k: TradeEvaluation, c: TradeEvaluation) => (k.tradeScore as number) >= (c.tradeScore as number) && printedAcceptance(k.pComplete) >= printedAcceptance(c.pComplete) - 1e-9;
const beats = (k: TradeEvaluation, c: TradeEvaluation) => k.key !== c.key && versionsOfSameTrade(k, c) && asGood(k, c) && !(asGood(c, k) && compareOverall(c, k) < 0);

/**
 * A search's dropped versions hold, on both lists: no card of a list is beaten by another version on it; each dropped version's
 * `by` is a card of its list or a trade merged into one, and beats it on the printed numbers; the counts. Its drops, and how many
 * were dropped for a merged trade.
 */
function dropsHold(r: TradeSearchResult, where: string): { drops: number; byMerged: number } {
  const st = searchStateOf(r) as SearchState;
  const merged = r.merged;
  if (!merged?.dominated) throw new Error("no dropped versions recorded");
  let drops = 0;
  let byMerged = 0;
  for (const [name, list, mergedHere, dropped] of [
    ["overall", r.trades, merged.overall, r.dropped?.dominated],
    ["helpsBoth", r.helpsBoth?.trades ?? [], merged.helpsBoth, r.helpsBoth?.dropped.dominated],
  ] as const) {
    const w = `${where} ${name}`;
    for (const a of list) for (const b of list) expect(beats(a, b), `${w}: ${b.key} beaten by ${a.key}`).toBe(false);
    const shown = new Map<string, TradeEvaluation>([...list.map((t) => [t.key, t] as const), ...mergedHere.map((m) => [m.key, st.shownByKey.get(m.key) as TradeEvaluation] as const)]);
    const mine = merged.dominated.filter((d) => d.list === name);
    expect(dropped, w).toBe(mine.length);
    for (const d of mine) {
      drops++;
      const by = shown.get(d.by);
      const self = st.shownByKey.get(d.key) as TradeEvaluation;
      expect(by, `${w}: ${d.key}'s by ${d.by}`).toBeDefined();
      expect(beats(by as TradeEvaluation, self), `${w}: ${d.key} by ${d.by}`).toBe(true);
      expect(list.some((t) => t.key === d.key), `${w} ${d.key}`).toBe(false);
      if (mergedHere.some((m) => m.key === d.by)) byMerged++;
    }
  }
  return { drops, byMerged };
}

describe("dropped versions on whole searches", { timeout: 900_000 }, () => {
  it("no card of a list is beaten by another version on it; every dropped version's `by` is on its list (a card or a merged trade) and beats it; the counts", () => {
    let drops = 0;
    let byMerged = 0;
    for (const lg of LEAGUES) {
      const r = searchOf(lg);
      const held = dropsHold(r, nameOf(lg));
      drops += held.drops;
      byMerged += held.byMerged;
      // The dropped versions qualified (each was a card), so they count among the qualifying ones, as without the rule.
      const plain = searchOf(lg, { mergeCards: false });
      expect(r.filter?.qualifying, nameOf(lg)).toBe(plain.filter?.qualifying);
      expect(r.helpsBoth?.qualifying, nameOf(lg)).toBe(plain.helpsBoth?.qualifying);
    }
    expect(drops).toBeGreaterThan(0);
    expect(byMerged).toBeGreaterThan(0); // smallLeague 48 with Team 2: a version dropped for a trade merged into a card (a fact of the synthetic data)
  });

  it("at \"Any\", where \"<5%\" meets \"5%\" (smallLeague 72 and 19): every drop is at least as good on both as printed, and the versions printing \"5%\" stay beside their \"<5%\" ones (the final review, E1)", () => {
    // Each pair: a card printing "5%" and its version printing "<5%" with a higher Helps you, neither at least as good on both
    // (facts of the synthetic data; read as the nearest 5%, "<5%" tied with "5%" and the "5%" one left the list).
    for (const [seed, five, under] of [
      [72, "5|give:1012|get:1060", "5|give:1012|get:1055,1060"],
      [19, "6|give:1005,1007|get:1062,1064", "6|give:1007|get:1062,1064"],
    ] as const) {
      const r = search(seed, 6, 0);
      dropsHold(r, `${seed} at Any`);
      const card = r.trades.find((t) => t.key === five);
      const lower = r.trades.find((t) => t.key === under);
      expect(card, `${seed}: ${five}`).toBeDefined();
      expect(lower, `${seed}: ${under}`).toBeDefined();
      expect(printedAcceptance((card as TradeEvaluation).pComplete)).toBe(0.05);
      expect(printedAcceptance((lower as TradeEvaluation).pComplete)).toBe(0);
      expect((lower as TradeEvaluation).tradeScore as number).toBeGreaterThan((card as TradeEvaluation).tradeScore as number);
      expect(r.merged?.dominated?.map((d) => d.key)).not.toContain(five);
    }
  });

  it("a dropped version's `by` that leaves (the final review, E2): smallLeague 48 searched with Team 2 (10%), and 29's chain searched with Team 5 at \"Any\"", () => {
    // smallLeague 48, Team 2: (c) dropped 1001 → 1018, which held 1001 → 1017 as its Open, so the release rule gives 1001 → 1017
    // back in that very round (and 1007 → 1017 + 1018 with it), and the next round ranks them before (c) reads the list again.
    // Read rounds later, as before, they took the given-player cap's places and pushed off 1001 → 1017 + 1018 (89 / 10%), which
    // 1001 + 1006 → 1017 + 1018 (88 / 10%) had been dropped for: neither showed. Now the latter shows, no version given back after.
    const r48 = search(48, 6, 0.1, { partnerId: "2" });
    dropsHold(r48, "48 (Team 2)");
    expect(r48.trades.map((t) => t.key)).toContain("2|give:1001,1006|get:1017,1018");
    expect(r48.merged?.released).toBe(2);
    expect(r48.merged?.restored).toBe(0);
    // smallLeague 29, Team 5, at Any: 1002 + 1005 → 1056 is dropped for 1005 → 1056, which a later round drops for 1002 + 1005 →
    // 1051 + 1056; that one beats the first too, so its `by` is re-pointed to it (it read 1005 → 1056, a card no more).
    const r29 = search(29, 6, 0, { partnerId: "5" });
    dropsHold(r29, "29 (Team 5) at Any");
    expect(r29.merged?.dominated).toContainEqual({ key: "5|give:1002,1005|get:1056", by: "5|give:1002,1005|get:1051,1056", list: "overall" });
    expect(r29.merged?.dominated).toContainEqual({ key: "5|give:1005|get:1056", by: "5|give:1002,1005|get:1051,1056", list: "overall" });
  });

  it("Plan B reads them as their list's cards: no box is a dropped version, nor one a dropped version of its list matches or beats", () => {
    let boxes = 0;
    for (const lg of LEAGUES) {
      const r = searchOf(lg);
      const st = searchStateOf(r) as SearchState;
      for (const [name, list] of [
        ["overall", r.trades],
        ["helpsBoth", r.helpsBoth?.trades ?? []],
      ] as const) {
        const dropped = (r.merged?.dominated ?? []).filter((d) => d.list === name).map((d) => st.shownByKey.get(d.key) as TradeEvaluation);
        for (const c of list) {
          if (!c.planB) continue;
          boxes++;
          expect(dropped.map((d) => d.key)).not.toContain(c.planB.key);
          expect(dominatedByCard(c.planB, dropped), `${lg.seed} ${c.key} box ${c.planB.key}`).toBe(false);
        }
      }
    }
    expect(boxes).toBeGreaterThan(0);
  });

  it("smallLeague 48 (10%): the dropped card held a merged trade, which comes back as a card (the release rule, the lead's D18; since the final review's E2 in the round of the drop)", () => {
    const r = search(48, 6, 0.1);
    const plain = search(48, 6, 0.1, { dropDominated: false });
    const holder = "2|give:1001|get:1018";
    const held = "2|give:1001|get:1017";
    expect(plain.merged?.overall).toContainEqual({ key: held, into: holder, kind: "open" });
    expect(r.merged?.dominated).toContainEqual({ key: holder, by: "2|give:1001,1006|get:1018", list: "overall" });
    expect(r.merged?.released).toBe(1);
    expect(r.trades.map((t) => t.key)).toContain(held);
    expect(r.merged?.overall.map((m) => m.key)).not.toContain(held);
    // No card's offers hold a card of its list below it after it.
    const cards = new Map(r.trades.map((t) => [t.key, t]));
    for (const c of r.trades) for (const s of (offerLadderOfSearch(r, c.key) as OfferLadder).steps) {
      const other = s.kind === "suggested" ? undefined : cards.get(s.evaluation.key);
      if (other) expect(compareOverall(other, c), `${c.key} ${s.kind} ${other.key}`).toBeLessThan(0);
    }
  });

  it("with the switch off (TradeSearchOptions.dropDominated false) nothing is dropped, and nothing says so", () => {
    for (const lg of LEAGUES.slice(0, 3)) {
      const r = search(lg.seed, lg.teams, lg.minChance, { dropDominated: false });
      expect(r.merged?.dominated).toBeUndefined();
      expect(r.dropped && "dominated" in r.dropped).toBe(false);
      expect(r.helpsBoth && "dominated" in r.helpsBoth.dropped).toBe(false);
    }
  });
});
