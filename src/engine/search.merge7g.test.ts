/**
 * Merged cards since Checkpoint 7g (planner reply to Checkpoint 7f, answer 3; search.ts, "Merged cards, Checkpoint 7g"), as a
 * whole: the switches (TradeSearchOptions.smallerAsks, preferListed, dropDominated: with all three off the search is Checkpoint
 * 7f's on this tree, bit for bit, against values stored from HEAD 7ad0e4a by running these very searches there: each list's
 * cards with B, P_complete, Helps you, Overall, Plan B and offers, the merge, the counts; a change that moves any of them, with
 * the switches off, fails here, as reward.pinned.test.ts's stored values do), Checkpoint 7f's invariants with all three on at
 * config.offers.lastMinOverallShare 0.8 and again at 0.75 (the planner's pick since Checkpoint 7h: no card's offers hold a card of
 * its list below it on Overall, every merged trade is an offer of a card above it; since Checkpoint 7h with the promoted Last
 * offers too, a promoted card's original among them, merged as its "open"), and re-filters equal to fresh searches. Synthetic leagues
 * (trade.testing.ts smallLeague: made-up players, placeholder teams): smallLeague 24 and 48 at 10%, 12-team 1 at Any, where all
 * three rules act (facts of the synthetic data, found on this tree).
 */
import { afterAll, describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext, type TradeContext } from "./evaluate";
import { offerLadderOfSearch } from "./offers";
import { compareOverall } from "./rank";
import { runRefilter, runTradeSearch, searchStateOf, type SearchState } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";
import type { OfferLadder, TradeEvaluation, TradeSearchResult } from "./tradeModel";

type Card = [key: string, b: number, pComplete: number, helpsYou: number, overall: number, planB: string | null, offers: string];
interface Pinned {
  overall: Card[];
  helpsBoth: Card[];
  merged: unknown;
  dropped: unknown;
  bothDropped: unknown;
  bothQualifying: number;
  filter: unknown;
  counts: unknown;
}

/** Stored from HEAD 7ad0e4a (Checkpoint 7f's engine with Checkpoint 7g's items 1, 3 and 4), by running these searches there. */
const HEAD: Record<"small24" | "small48" | "twelve1", Pinned> = {
  small24: {
    overall: [
      ["6|give:1011|get:1065,1067", 9.875997363155292, 0.2884955753591161, 97, 63, "6|give:1011|get:1067", "open:6|give:1011|get:1063,1068"],
      ["6|give:1011|get:1063,1065", 9.958530348046693, 0.27205374378842145, 97, 61, "6|give:1011|get:1067", "open:6|give:1011|get:1063,1068"],
      ["6|give:1011|get:1063,1067", 9.110246393270302, 0.2194776805170653, 96, 50, "6|give:1011|get:1067", "open:6|give:1011|get:1063,1068"],
      ["3|give:1003|get:1032", 4.804980447270814, 0.09648159603234546, 81, 15, "3|give:1011|get:1036", "last:3|give:1003,1011|get:1032"],
      ["3|give:1008|get:1032", 4.751569854505954, 0.09197785262148622, 81, 14, "3|give:1011|get:1036", "last:3|give:1008,1011|get:1032"],
      ["3|give:1012|get:1032", 3.0860193645632688, 0.12839137853724628, 66, 13, "3|give:1011|get:1036", "last:3|give:1011,1012|get:1032"],
      ["2|give:1008|get:1018", 3.5817673167042083, 0.1007934400300949, 71, 12, null, "last:2|give:1008,1011|get:1018"],
      ["2|give:1003|get:1018", 3.554016320156566, 0.1007934400300949, 71, 12, null, "last:2|give:1003,1011|get:1018"],
      ["2|give:1002|get:1015,1018", 2.6695515866747157, 0.10413653885817963, 61, 9, null, "last:2|give:1002,1011|get:1015,1018"],
      ["4|give:1002,1008|get:1048", 0.9819019922495512, 0.17677794896987334, 29, 6, null, ""],
      ["4|give:1002|get:1048", 0.7651218518751943, 0.21305356821060983, 23, 6, null, ""],
    ],
    helpsBoth: [
      ["3|give:1007|get:1031,1032", 2.993117955824373, 0.08832038498361197, 65, 9, null, "last:3|give:1007,1011|get:1031,1032"],
      ["4|give:1003,1011|get:1048", 1.3074822946691236, 0.4772761059636216, 37, 20, null, "open:4|give:1003,1011|get:1040,1048"],
      ["4|give:1011|get:1040,1048", 1.2827068622907587, 0.5474150388577144, 36, 22, null, ""],
      ["4|give:1002|get:1040,1048", 0.7263205353295068, 0.19028620702270427, 22, 5, "4|give:1011|get:1048", ""],
    ],
    merged: {"overall": [], "helpsBoth": [], "rounds": {"overall": 1, "helpsBoth": 1}, "ladders": 1, "released": 0},
    dropped: {"partnerCap": 13, "core": 1, "filler": 1, "givenPlayer": 33, "merged": 0},
    bothDropped: {"partnerCap": 0, "core": 1, "filler": 0, "givenPlayer": 0, "merged": 0},
    bothQualifying: 5,
    filter: {"minChance": 0.1, "qualifying": 59, "few": false},
    counts: {"screened": 6799, "exact": 186, "simScreen": 186, "simFinal": 67, "simShown": 18},
  },
  small48: {
    overall: [
      ["5|give:1006,1007|get:1054", 3.651932852538584, 0.494553762510318, 61, 37, null, "open:5|give:1006,1007|get:1054,1055 then:5|give:1007|get:1054"],
      ["2|give:1001,1006|get:1018", 3.1823909958641328, 0.4165271422735479, 56, 29, null, "open:2|give:1001,1006|get:1018,1020 then:2|give:1001,1006|get:1017"],
      ["5|give:1007|get:1054,1055", 6.590952653680453, 0.18486923349934128, 82, 27, null, "last:5|give:1006,1007|get:1054,1055"],
      ["2|give:1006,1007|get:1018,1019", 2.725700143372036, 0.44416865090299174, 50, 27, null, ""],
      ["2|give:1001|get:1017", 3.399901593022862, 0.31800852648488437, 58, 24, null, "open:2|give:1001|get:1018,1020"],
      ["5|give:1001|get:1054", 10.170994572493443, 0.0784136429161227, 93, 18, null, ""],
    ],
    helpsBoth: [
    ],
    merged: {"overall": [{"key": "5|give:1006,1007|get:1054,1055", "into": "5|give:1006,1007|get:1054", "kind": "open"}, {"key": "5|give:1007|get:1054", "into": "5|give:1006,1007|get:1054", "kind": "then"}, {"key": "2|give:1001,1006|get:1018,1020", "into": "2|give:1001,1006|get:1018", "kind": "open"}], "helpsBoth": [], "rounds": {"overall": 3, "helpsBoth": 1}, "ladders": 3, "released": 0},
    dropped: {"partnerCap": 19, "core": 0, "filler": 8, "givenPlayer": 7, "merged": 3},
    bothDropped: {"partnerCap": 0, "core": 0, "filler": 0, "givenPlayer": 0, "merged": 0},
    bothQualifying: 0,
    filter: {"minChance": 0.1, "qualifying": 43, "few": false},
    counts: {"screened": 4450, "exact": 183, "simScreen": 183, "simFinal": 61, "simShown": 6},
  },
  twelve1: {
    overall: [
      ["3|give:1011|get:1036", 6.881353191133766, 0.5573244568304963, 86, 67, null, "open:3|give:1011|get:1030,1036 then:3|give:1011|get:1026,1036 then:3|give:1011|get:1032,1036"],
      ["2|give:1001,1008|get:1014,1016", 7.083897063053399, 0.5353834557805108, 87, 67, "2|give:1001|get:1016", "open:2|give:1001,1008|get:1016,1019"],
      ["9|give:1011|get:1104,1108", 8.135070164181576, 0.45522116587750905, 90, 66, "9|give:1004,1011|get:1098,1101", "open:9|give:1011|get:1098,1102 then:9|give:1011|get:1102,1108 then:9|give:1011|get:1098,1104"],
      ["9|give:1011|get:1108", 6.672256872130874, 0.5492404917341924, 85, 65, "9|give:1004,1011|get:1098,1101", "open:9|give:1011|get:1098,1102 then:9|give:1011|get:1102,1108 then:9|give:1011|get:1098,1104"],
      ["2|give:1001|get:1014,1016", 7.306861681337173, 0.39809718134381883, 88, 57, "2|give:1001|get:1016", "open:2|give:1001|get:1016,1019"],
      ["12|give:1004|get:1139,1140", 3.1557052472906566, 0.798939685139236, 60, 52, null, "open:12|give:1004|get:1137,1144"],
      ["2|give:1001|get:1015", 5.432540152798725, 0.4176125547148923, 79, 48, "2|give:1001|get:1016", "open:2|give:1001|get:1016,1019 then:2|give:1001|get:1015,1018"],
      ["9|give:1004|get:1101,1108", 4.806708504635043, 0.43319518901559956, 75, 45, "9|give:1004,1011|get:1098,1101", "open:9|give:1004|get:1098,1101 last:9|give:1004,1011|get:1101,1108"],
      ["4|give:1004|get:1041,1042", 3.787912266842579, 0.4339389078766421, 67, 38, null, ""],
      ["12|give:1012|get:1144", 6.73855045727781, 0.13597148505233603, 86, 23, null, ""],
      ["10|give:1005|get:1110,1112", 2.9227371025959363, 0.3130591555661457, 57, 23, null, "last:10|give:1005,1011|get:1110,1112"],
      ["12|give:1012|get:1134", 5.538528912765212, 0.15832785862909055, 80, 22, null, ""],
      ["6|give:1005|get:1064,1067", 7.132988046881464, 0.1169155637949241, 87, 21, "6|give:1011|get:1063", "last:6|give:1005,1011|get:1064,1067"],
      ["10|give:1012|get:1111", 3.754774198515636, 0.21443551426282828, 66, 21, "10|give:1005,1011|get:1110,1112", "open:10|give:1012|get:1113,1120"],
      ["6|give:1005|get:1064,1066", 7.330891809194779, 0.09862194618279144, 88, 19, "6|give:1001|get:1062", "last:6|give:1005,1011|get:1064,1066"],
      ["5|give:1008|get:1050,1053", 4.773897143871317, 0.14264078740942124, 75, 18, "5|give:1004|get:1054,1055", ""],
      ["5|give:1008|get:1051,1053", 5.2419177896379585, 0.12584039901118152, 78, 17, "5|give:1008|get:1051", ""],
    ],
    helpsBoth: [
      ["9|give:1004,1011|get:1101,1108", 4.580735166908684, 0.7235440938568716, 73, 62, null, ""],
      ["9|give:1004|get:1098,1100", 3.892214262274771, 0.49195362501931306, 68, 43, null, "last:9|give:1004,1011|get:1098,1100"],
      ["9|give:1004,1011|get:1098,1100", 3.5460216464776493, 0.7497530355743822, 64, 54, null, "open:9|give:1004,1011|get:1101,1108"],
      ["10|give:1005,1011|get:1110,1112", 2.583359364305408, 0.5784397099595208, 53, 35, null, ""],
    ],
    merged: {"overall": [], "helpsBoth": [], "rounds": {"overall": 1, "helpsBoth": 1}, "ladders": 1, "released": 0},
    dropped: {"partnerCap": 6, "core": 2, "filler": 5, "givenPlayer": 30, "merged": 0},
    bothDropped: {"partnerCap": 7, "core": 0, "filler": 0, "givenPlayer": 0, "merged": 0},
    bothQualifying: 11,
    filter: {"minChance": 0, "qualifying": 60, "few": false},
    counts: {"screened": 15207, "exact": 267, "simScreen": 267, "simFinal": 72, "simShown": 27},
  },
};

const LEAGUES: Record<keyof typeof HEAD, { seed: number; teams: number; minChance: number }> = {
  small24: { seed: 24, teams: 6, minChance: 0.1 },
  small48: { seed: 48, teams: 6, minChance: 0.1 },
  twelve1: { seed: 1, teams: 12, minChance: 0 },
};
// Since Checkpoint 7h also its promoted Last offers off (TradeSearchOptions.promoteLastOffers), so the stored values still pin
// Checkpoint 7f's search (the 7g switches off read neither config.offers.lastMinOverallShare nor preferWithinHelps).
const OFF = { smallerAsks: false, preferListed: false, dropDominated: false, promoteLastOffers: false } as const;
const at = (minChance: number): TradeSettings => ({ ...defaultTradeSettings(), minChance });

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

/** A search's compact signature (the stored values' shape). */
function signature(r: TradeSearchResult): Pinned {
  const sig = (cards: readonly TradeEvaluation[]): Card[] =>
    cards.map((t) => [
      t.key,
      t.b as number,
      t.pComplete,
      t.tradeScore as number,
      t.overall as number,
      t.planB?.key ?? null,
      ((offerLadderOfSearch(r, t.key) as OfferLadder | null)?.steps ?? [])
        .filter((s) => s.kind !== "suggested")
        .map((s) => `${s.kind}:${s.evaluation.key}`)
        .join(" "),
    ]);
  return { overall: sig(r.trades), helpsBoth: sig(r.helpsBoth?.trades ?? []), merged: r.merged, dropped: r.dropped, bothDropped: r.helpsBoth?.dropped, bothQualifying: r.helpsBoth?.qualifying as number, filter: r.filter, counts: r.counts };
}

/** No card's offers hold a card of its list below it on Overall; every merged trade is an offer of its card, on the list above it. */
function expectInvariants(r: TradeSearchResult, where: string): void {
  for (const [name, cards, merged] of [
    ["overall", r.trades, r.merged?.overall ?? []],
    ["helpsBoth", r.helpsBoth?.trades ?? [], r.merged?.helpsBoth ?? []],
  ] as const) {
    const byKey = new Map(cards.map((t) => [t.key, t]));
    for (const c of cards) {
      for (const s of (offerLadderOfSearch(r, c.key) as OfferLadder).steps) {
        const other = s.kind === "suggested" ? undefined : byKey.get(s.evaluation.key);
        if (other) expect(compareOverall(other, c), `${where} ${name}: ${c.key} ${s.kind} ${other.key}`).toBeLessThan(0);
      }
    }
    for (const m of merged) {
      const keeper = byKey.get(m.into) as TradeEvaluation;
      expect(keeper, `${where} ${name}: ${m.key} into ${m.into}`).toBeDefined();
      const step = (offerLadderOfSearch(r, m.into) as OfferLadder).steps.find((s) => s.evaluation.key === m.key);
      expect(step?.kind, `${where} ${name}: ${m.key}`).toBe(m.kind);
      expect(compareOverall(keeper, step?.evaluation as TradeEvaluation), `${where} ${name}: ${m.key}`).toBeLessThan(0);
    }
  }
}

describe("merged cards since Checkpoint 7g: the switches, the invariants, re-filters", { timeout: 900_000 }, () => {
  const share = config.offers as { lastMinOverallShare: number };
  const original = share.lastMinOverallShare;
  afterAll(() => {
    share.lastMinOverallShare = original;
  });

  for (const name of Object.keys(HEAD) as (keyof typeof HEAD)[]) {
    const lg = LEAGUES[name];
    it(`${name}: with every Checkpoint 7g switch off, Checkpoint 7f's search on this tree, bit for bit (stored values); with them on, it moves`, () => {
      const off = runTradeSearch(contextOf(lg.seed, lg.teams), { settings: at(lg.minChance), ...OFF });
      expect(signature(off)).toEqual(HEAD[name]);
      const on = runTradeSearch(contextOf(lg.seed, lg.teams), { settings: at(lg.minChance) });
      expect(signature(on)).not.toEqual(HEAD[name]);
    });
  }

  for (const value of [0.8, 0.75]) {
    it(`at lastMinOverallShare ${value}: no card's offers hold a card of its list below it, every merged trade is an offer of a card above it (smallLeague 24 and 48 at 10%, 12-team 1 at Any)`, () => {
      share.lastMinOverallShare = value;
      try {
        for (const name of Object.keys(HEAD) as (keyof typeof HEAD)[]) {
          const lg = LEAGUES[name];
          expectInvariants(runTradeSearch(contextOf(lg.seed, lg.teams), { settings: at(lg.minChance) }), `${name} at ${value}`);
        }
      } finally {
        share.lastMinOverallShare = original;
      }
    });
  }

  it("a re-filter there and back equals a fresh search, merges, dropped versions and preferences included (smallLeague 24 and 48)", () => {
    for (const name of ["small24", "small48"] as const) {
      const lg = LEAGUES[name];
      const ctx = contextOf(lg.seed, lg.teams);
      const r = runTradeSearch(ctx, { settings: at(lg.minChance) });
      for (const other of [0, 0.2]) {
        const there = runRefilter(ctx, searchStateOf(r) as SearchState, { minChance: other });
        expect(there, `${name} to ${other}`).toEqual(runTradeSearch(ctx, { settings: at(other) }));
        expectInvariants(there, `${name} at ${other}`);
        const back = runRefilter(ctx, searchStateOf(there) as SearchState, { minChance: lg.minChance });
        expect(back, `${name} back from ${other}`).toEqual(r);
        expect(signature(back)).toEqual(signature(r));
      }
    }
  });
});
