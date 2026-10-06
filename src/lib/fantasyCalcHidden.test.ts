/**
 * The guard for "no trade values on screen" (planner reply to Checkpoint 7a, 5.4; POLICY_FEATURES.fantasyCalcHidden in
 * src/lib/site.ts, which the privacy and terms pages read): Offer Sheet uses FantasyCalc's trade values in its own numbers
 * (the chance a manager accepts, Helps you, how far projections lean toward the trade market) but never shows them, nor
 * any comparison of them. Every page that could is built here from fixtures whose values are distinctive (7,777 and 8,888:
 * FantasyCalc's list, the model's own values, estimates and minimums, the waiver credit, the top value, a trade's value
 * given and received and its long-term value change; every sum and difference of up to four of them is a multiple of 1,111
 * that nothing else prints) and read as a visitor would: the trade cards (reasons, message, offer-first steps, Plan B, flags
 * and facts), the Trade Finder's list and "How to read", the Trade Analyzer's result with its Details, the League page with
 * every player's breakdown (blended players among them: the market blend's line, down, up, capped either way, and a player
 * at the end of his position's value range), the Settings page (every league type and "Protect my trade value" level) and
 * the Import Report. None may show either value or a sum or difference of them (with or without the thousands comma), a
 * percent more or less trade value, a long-term value change in percents, the market blend's numbers ("Our projection
 * 210 · Trade market 170"), what an uncapped blend "would be", which end of FantasyCalc's range a player is at, or
 * FantasyCalc's own comparison. The view models' strings are checked too, since a collapsed breakdown isn't in the first
 * render. ⚠️ The Analyzer's "Trade value: −0.4 pts/week equivalent." (planner reply to Checkpoint 7a, §2 question 5) is
 * allowed while no page prints an exchange rate between trade value and points, which would turn it back into the trade's
 * value comparison (review of Phase 7b): Settings is read for one. Every name is made up.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView, type RefreshControl } from "@/components/import/ReportView";
import { LeagueView } from "@/components/league/LeagueView";
import { PlayerDetail } from "@/components/league/PlayerTable";
import { leagueFixture, type LeagueFixture } from "@/components/league/testFixtures";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { buildSettingsView } from "@/components/settings/settingsView";
import { AnalysisResult } from "@/components/trades/AnalyzerPage";
import { HowToRead } from "@/components/trades/HowToRead";
import { TradeCard } from "@/components/trades/TradeCard";
import { FinderFrame } from "@/components/trades/TradeFinderPage";
import { GLOOP_PREMIUM, evaluation, searchResult, steppedFull, tradeSnapshot } from "@/components/trades/testFixtures";
import type { HelpsScale } from "@/engine/benefit";
import { explainTrade, type ExplainContext } from "@/engine/explain";
import type { MarketInputs } from "@/engine/inputs";
import type { PlayerBlend } from "@/engine/leagueModel";
import type { LeagueSnapshot } from "@/engine/model";
import { PROTECT_VALUE_LEVELS, defaultTradeSettings } from "@/engine/settings";
import { acceptanceTerms, planBFixture, type EvaluationFixture } from "@/engine/tradeTestFixtures";
import type { TradeEvaluation } from "@/engine/tradeModel";
import { buildImportReport } from "./importReport";
import { buildLeagueView } from "./leagueView";
import type { CardFeedback } from "./tradeView";
import { buildAnalysisView, buildFinderView, buildTradeCard, fantasyCalcLookup } from "./tradeView";

/**
 * Every sum and difference of up to four values on either side (|a × 7,777 + b × 8,888| for |a|, |b| ≤ 4, but the two
 * values themselves: package totals with waiver credits, a trade's value given and received, the gap between them), as a
 * whole number with or without the thousands comma: all multiples of 1,111 the pages never print otherwise.
 */
const DERIVED: RegExp = (() => {
  const values = new Set<number>();
  for (let a = -4; a <= 4; a++)
    for (let b = -4; b <= 4; b++) {
      const v = Math.abs(7777 * a + 8888 * b);
      if (v > 0 && v !== 7777 && v !== 8888) values.add(v);
    }
  const alternatives = [...values].sort((x, y) => x - y).map((v) => String(v).replace(/(\d)(\d{3})$/, "$1,?$2"));
  return new RegExp(`(?<![\\d,.])(?:${alternatives.join("|")})(?!\\d|[.,]\\d)`);
})();

/**
 * What may never show: either value or a sum or difference of them, a percent more or less (trade) value, a long-term value
 * change in percents, the market blend's numbers and ends of range, the old Details' "from your odds alone", FantasyCalc's
 * own comparison, a value multiple.
 */
const FORBIDDEN: readonly RegExp[] = [
  /7,?777/,
  /8,?888/,
  DERIVED,
  /\d+(?:\.\d+)?% (?:more|less) (?:trade value|value|than)/i,
  /long-term value by \d+%/i,
  /\d+% of your roster/i,
  /Our projection \d/i,
  /Trade market:? \d/i,
  /would be \d/i,
  /no comparison \(|(?:top|lowest) value at his position/i,
  /from your odds alone: \d/i,
  /by FantasyCalc's (?:trade )?values/i,
  /times as much/i,
];

function expectHidden(where: string, text: string): void {
  for (const re of FORBIDDEN) expect(text, `${where} shows ${re}: ${text.slice(Math.max(0, text.search(re) - 80), text.search(re) + 80)}`).not.toMatch(re);
}

/** Every string in a view model (numbers aren't shown as they are: the raw engine data in a view is numbers). */
function stringsOf(x: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof x === "string") out.push(x);
  else if (x && typeof x === "object" && !seen.has(x)) {
    seen.add(x);
    for (const v of Array.isArray(x) ? x : Object.values(x)) stringsOf(v, out, seen);
  }
  return out;
}

const noop = () => {};
const saved = () => ({ ok: true as const });
const NONE: CardFeedback = { outcome: null, report: null, version: null, versionKey: null, versionWords: null };
const refresh: RefreshControl = { onRefresh: noop, refreshing: false, error: null, status: null };

/** The fictional league's FantasyCalc list, every value 7,777 or 8,888. */
const IDS = ["101", "102", "103", "104", "105", "106", "107", "201", "202", "203", "204", "205", "301", "302", "303", "304", "305", "401", "402", "403", "404", "405"];
const VALUES: Record<string, number> = Object.fromEntries(IDS.map((id, i) => [id, i % 2 ? 7777 : 8888]));
const MARKET: MarketInputs = {
  format: { isDynasty: false, numQbs: 1, numTeams: 10, ppr: 1, substitutions: [] },
  fetchedAt: "2026-11-26T20:00:00.000Z",
  values: VALUES,
  knownIds: [],
  topValue: 8888,
};
const FC = fantasyCalcLookup(MARKET);

/** The search's or the evaluation's Helps you scale in a dynasty league (the mix with long-term value). */
const MIX: HelpsScale = { b3: 4.65, raw: 4.65, floored: false, odds: 5, oddsNamed: "title", lambda: 0.35, f10: 4, gainReads: 50, futureReads: 26, reason: null };

/**
 * Blended players (PlayerModel.blend: the League page breakdown's market blend line; review of Phase 7b): the market pulls
 * one down and one up, caps one either way, and one's market number is his own (the end of his position's value range).
 */
const BLENDS: Record<string, PlayerBlend> = {
  "101": { ours: 431.7, market: 289.3, used: 360.5, weight: 0.5 },
  "103": { ours: 212.2, market: 377.9, used: 295.05, weight: 0.5 },
  "201": { ours: 123.4, market: 345.6, used: 166.59, weight: 0.5, clamped: "high" },
  "202": { ours: 333.3, market: 66.6, used: 249.98, weight: 0.5, clamped: "low" },
  "301": { ours: 313.2, market: 313.2, used: 313.2, weight: 0.5 },
};

/** What a blended player's line may never show: the market's number, ours before the blend (with his ROS, it gives the market's back) and the uncapped blend. */
const blendNumbers = (b: PlayerBlend): RegExp[] => [b.market, b.ours, (1 - b.weight) * b.ours + b.weight * b.market].map((x) => new RegExp(`(?<![\\d.,])${Math.round(x)}(?![\\d]|[.,]\\d)`));

/**
 * The fixture league with every value 7,777 or 8,888 (FantasyCalc's own, our estimates and the flat minimums alike), the
 * waiver credit and top value among them, and BLENDS' players blended.
 */
function distinctive(edit?: (f: LeagueFixture) => void): LeagueFixture {
  const f = leagueFixture();
  let i = 0;
  for (const pm of Object.values(f.model.players)) if (pm.value) pm.value = { ...pm.value, value: i++ % 2 ? 7777 : 8888 };
  for (const [id, blend] of Object.entries(BLENDS)) {
    const pm = f.model.players[id];
    if (!pm) throw new Error(`fixture player ${id} missing`);
    f.model.players[id] = { ...pm, blend };
  }
  f.model.market = { ...f.model.market, waiverCredit: 7777, topValue: 8888 };
  f.inputs = { ...f.inputs, market: { ...MARKET, format: f.model.market.format ?? MARKET.format } };
  edit?.(f);
  return f;
}

/** The reasons and the message as the engine words them for this league (explain.ts, with the FantasyCalc lookup). */
function worded(e: TradeEvaluation, snapshot: LeagueSnapshot, f: LeagueFixture): TradeEvaluation {
  const ctx: ExplainContext = {
    teamName: (id) => snapshot.teams.find((t) => t.id === id)?.name ?? `Team ${id}`,
    player: (id) => {
      const p = snapshot.players[id];
      return p ? { name: p.name, pos: p.pos, nflTeam: p.nflTeam, injury: p.injury } : null;
    },
    slots: f.model.slots,
    leagueType: snapshot.settings.leagueType,
    tradeDeadline: snapshot.settings.tradeDeadline,
    fantasyCalcValue: FC.value,
    baseline: { pPlayoffs: 0.62, pTitle: 0.09 },
  };
  const words = explainTrade(e, ctx);
  expect(words.reasons.length).toBeGreaterThan(0);
  return { ...e, ...words };
}

/** A trade in this league whose value given and received are the distinctive ones. */
const trade = (o: EvaluationFixture = {}) => evaluation({ value: { given: 8888, received: 7777 }, ...o });

describe("the guard itself", () => {
  it("catches a value, a sum or difference of them, or a value comparison, and lets the scale's anchor and the Analyzer's points a week through", () => {
    for (const leak of [
      "Trade value: You give 8,888, you get 7,777",
      "Value 7777",
      "~8,888",
      "You give 16,665, you get 15,554",
      "they give up 1,111 more",
      "2,222",
      "By FantasyCalc's trade values, they get 18% more than they give.",
      "They give up 8% more trade value than they get.",
      "They get 14% more value.",
      "about 9.3 times as much as they get",
      // Strings Checkpoint 7b's first pass left or removed (review of Phase 7b).
      "Raises your roster's long-term value by 5%, counting roster spots.",
      "Costs 3% of your roster's long-term value, counting roster spots.",
      "Our projection 210 · Trade market 170 · Used 190",
      "Used: 50% ours and 50% the market's would be 130, but the market moves a projection at most 35% up",
      "Our projection 313 · Trade market: no comparison (top value at his position) · Used 313",
      "Helps you from your odds alone: 41; counting trade value at your setting: 35.",
      "Medium: giving 25% more trade value than you get costs about 0.4 points a week (Low 0.2, High 0.8).",
    ]) {
      expect(() => expectHidden("a leak", leak), leak).toThrow();
    }
    expectHidden("the scale", "63 ≈ as good as adding 3 points a week to your lineup this season together with 10% more long-term value for your roster.");
    expectHidden("a value line", "They come out ahead on trade value, which makes a yes more likely.");
    expectHidden("a blend line", "His projection leans up toward the trade market's view, by the most it can: 35%.");
    expectHidden("the Analyzer's Details", "Trade value: −0.4 pts/week equivalent.");
    // Numbers that merely contain a derived one aren't caught: 21,111 or 1,111.5 are not 1,111.
    expectHidden("other numbers", "Looked at 21,111 trade ideas; 1,111.5 points; 5,000 seasons; 2026.");
  });
});

describe("no trade value shows on the trade pages (planner reply to Checkpoint 7a, 5.4)", () => {
  const f = leagueFixture();
  const snapshot = tradeSnapshot();
  const dynasty: LeagueSnapshot = { ...snapshot, settings: { ...snapshot.settings, leagueType: "dynasty" } };

  // Every reason that reads trade value: they come out ahead, they give up more, about even, the star premium, the market
  // check, "Mostly a trade-value win", and in a dynasty league the long-term value up or down; with steps and a Plan B.
  const redraft: TradeEvaluation[] = [
    trade({ key: "ahead", gMine: -0.08, gPartner: 0.12, detail: { terms: acceptanceTerms({ value: 0.72 }) } }),
    trade({ key: "behind", gMine: 0.25, gPartner: -0.2, detail: { terms: acceptanceTerms({ value: -1.8 }) } }),
    trade({ key: "even", gMine: 0.01, gPartner: -0.01, detail: { terms: acceptanceTerms({ value: -0.06, need: 0.4 }) } }),
    trade({ key: "check", gMine: -0.3, gPartner: 0.42, detail: { terms: acceptanceTerms({ value: 2.5 }) } }),
    trade({ key: "premium", get: ["202"], gPartner: 0.3, detail: { premium: [GLOOP_PREMIUM], terms: acceptanceTerms({ value: 0.9 }) } }),
    trade({ key: "mostly", b: 3, bWin: 0.5, gMine: 0.3, gPartner: -0.23, dPPW: 0, dPPWPlayoffs: 0, dPO: 0, dCH: 0, detail: { terms: acceptanceTerms({ value: -2 }) } }),
    trade({ key: "planB", gPartner: 0.08, planB: planBFixture({ partnerId: "2", give: ["105"], get: ["203"] }), detail: { terms: acceptanceTerms({ value: 0.5 }) } }),
    { ...steppedFull({ gPartner: 0.1, value: { given: 8888, received: 7777 } }), key: "steps" },
  ].map((e) => worded(e, snapshot, f));
  const dynastyTrades: TradeEvaluation[] = [
    trade({ key: "up", b: 3, bWin: 1, bFuture: 2, lambda: 0.6, dDyn: 7777, gPartner: 0.1, detail: { terms: acceptanceTerms({ value: 0.6 }) } }),
    trade({ key: "down", b: 1, bWin: 2, bFuture: -1, lambda: 0.35, dDyn: -8888, gPartner: -0.1, detail: { terms: acceptanceTerms({ value: -0.6 }) } }),
  ].map((e) => worded(e, dynasty, f));

  it("words every reason and message about trade value without a number", () => {
    for (const e of [...redraft, ...dynastyTrades]) {
      expectHidden(`reasons of ${e.key}`, e.reasons.join(" "));
      expectHidden(`message of ${e.key}`, e.pitch);
    }
    // They do talk about trade value, in words.
    expect(redraft.flatMap((e) => e.reasons).join(" ")).toMatch(/come out ahead on trade value/);
    expect(dynastyTrades.flatMap((e) => e.reasons).join(" ")).toMatch(/long-term value/);
  });

  it("shows none on a card, with its flags, facts, steps, Plan B, message and FantasyCalc credit", () => {
    for (const e of redraft) {
      const card = buildTradeCard(e, { snapshot, fantasyCalc: FC, baseline: { pPlayoffs: 0.62, pTitle: 0.09 } });
      const html = renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: saved, showAnalyzerLink: true }));
      expectHidden(`card ${e.key}`, html);
      for (const s of stringsOf(card)) expectHidden(`card ${e.key}'s view`, s);
      // The trade is on the card, and the credit stays (§2.9), after a sentence.
      expect(html).toContain("Wiggleton Spoons");
      expect(html).toContain("Values: FantasyCalc");
    }
    for (const e of dynastyTrades) {
      const card = buildTradeCard(e, { snapshot: dynasty, fantasyCalc: FC, helpsScale: MIX });
      expectHidden(`card ${e.key}`, renderToStaticMarkup(createElement(TradeCard, { card, rank: 1, feedback: NONE, onFeedback: saved })));
      for (const s of stringsOf(card)) expectHidden(`card ${e.key}'s view`, s);
    }
  });

  it("shows none in the Trade Finder's list and its 'How to read'", () => {
    for (const [trades, snap, leagueType, scale] of [
      [redraft, snapshot, "redraft", null],
      [dynastyTrades, dynasty, "dynasty", MIX],
    ] as const) {
      const view = buildFinderView({ result: searchResult([...trades], { helpsScale: scale, hidden: { byBenefit: 1, byMarket: 2 } }), sort: "overall", snapshot: snap, partnerId: null, fantasyCalc: FC });
      const html = renderToStaticMarkup(
        createElement(FinderFrame, { state: { kind: "done", view }, teamName: "Moonbeam Mudcats", leagueType, controls: null, records: [], leagueKey: "espn:0000abcd", onFeedback: saved }),
      );
      expectHidden(`the ${leagueType} Finder`, html);
      for (const s of stringsOf(view)) expectHidden(`the ${leagueType} Finder's view`, s);
    }
    for (const leagueType of ["redraft", "keeper", "dynasty"] as const)
      for (const page of ["finder", "analyzer"] as const)
        for (const valuesOn of [true, false]) expectHidden(`How to read (${leagueType}, ${page})`, renderToStaticMarkup(createElement(HowToRead, { leagueType, page, valuesOn, helpsScale: leagueType === "redraft" ? null : MIX })));
  });

  it("shows none in the Trade Analyzer's result, Details included", () => {
    for (const [e, snap, leagueType, scale] of [
      ...redraft.map((x) => [x, snapshot, "redraft", null] as const),
      ...dynastyTrades.map((x) => [x, dynasty, "dynasty", MIX] as const),
    ]) {
      const view = buildAnalysisView({ evaluation: { ...e, marketWeekly: leagueType === "redraft" ? -0.4 : null }, illegal: null, notes: [], helpsScale: scale, baseline: { pPlayoffs: 0.62, pTitle: 0.09 } }, snap, undefined, { fantasyCalc: FC });
      const html = renderToStaticMarkup(createElement(AnalysisResult, { view, stale: false, records: [], leagueKey: "espn:0000abcd", leagueType, onFeedback: saved }));
      expectHidden(`the Analyzer (${e.key})`, html);
      for (const s of stringsOf(view)) expectHidden(`the Analyzer's view (${e.key})`, s);
      // Details are there, in points a week.
      expect(html).toContain("How Helps you adds up for this trade.");
    }
  });
});

describe("no trade value shows on the League page (planner reply to Checkpoint 7a, 5.4)", () => {
  const page = (f: LeagueFixture) => {
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: "2026-11-26T22:00:00.000Z" });
    const html = renderToStaticMarkup(createElement(LeagueView, { view, refresh }));
    const players = [...view.rosters.flatMap((r) => r.players), ...view.freeAgents.flatMap((g) => g.players)];
    const details = players.map((player) => renderToStaticMarkup(createElement(PlayerDetail, { player, showLineupCost: true })));
    return { view, html, players, details };
  };

  it("shows none in the tables, the breakdowns (the market blend's line too), the partner cards and the explainer, with FantasyCalc's values or our estimates", () => {
    const curve = { kind: "curve" as const, listDate: "2026-11-02T09:00:00.000Z" };
    const savedList = { kind: "saved" as const, listDate: "2026-11-22T09:00:00.000Z" };
    const cases: [string, LeagueFixture][] = [
      ["FantasyCalc's values", distinctive()],
      ["a saved list", distinctive((f) => (f.inputs = { ...f.inputs, market: f.inputs.market ? { ...f.inputs.market, fallback: savedList } : null }))],
      [
        "our estimates",
        distinctive((f) => {
          f.inputs = { ...f.inputs, market: f.inputs.market ? { ...f.inputs.market, fallback: curve } : null };
          for (const pm of Object.values(f.model.players)) if (pm.value?.source === "fantasycalc") pm.value = { ...pm.value, source: "estimate" };
        }),
      ],
      ["a dynasty league", distinctive((f) => (f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType: "dynasty" } }))],
    ];
    for (const [name, f] of cases) {
      const { view, html, players, details } = page(f);
      // Every rostered player and free agent's breakdown is read.
      expect(details.length).toBe(34);
      expect(html).toContain("Fizzwick Pemberton");
      expectHidden(`the League page (${name})`, html);
      details.forEach((d, i) => expectHidden(`a player's breakdown (${name}, ${i})`, d));
      for (const s of stringsOf(view)) expectHidden(`the League page's view (${name})`, s);
      // Each blended player's line is there, in words, without the market's number, ours before the blend or the uncapped
      // blend, in his breakdown or his hover.
      for (const [id, blend] of Object.entries(BLENDS)) {
        const i = players.findIndex((p) => p.id === id);
        const player = players[i];
        expect(player?.blend, `${name}: ${id}`).not.toBeNull();
        expect(details[i], `${name}: ${id}`).toContain("trade market");
        for (const re of blendNumbers(blend)) {
          expect(details[i], `${name}: ${id}'s breakdown shows ${re}`).not.toMatch(re);
          expect(player?.weeksText, `${name}: ${id}'s hover shows ${re}`).not.toMatch(re);
        }
      }
      // The credit stays (§2.9).
      expect(html).toContain("Values: FantasyCalc");
    }
  });
});

describe("no trade value shows in Settings or the Import Report (planner reply to Checkpoint 7a, 5.4)", () => {
  it("Settings, in every league type and at every Protect my trade value level, with FantasyCalc's values or our estimates: no exchange rate that would turn the Analyzer's points a week back into a value comparison (review of Phase 7b)", () => {
    const f = distinctive();
    let protectHelps = 0;
    for (const leagueType of ["redraft", "keeper", "dynasty"] as const)
      for (const protectValue of PROTECT_VALUE_LEVELS)
        for (const valuesEstimated of [false, true]) {
          const snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType } };
          const view = buildSettingsView({ snapshot, myTeamId: "1", settings: { ...defaultTradeSettings(), protectValue }, stored: true, valuesEstimated });
          const html = renderToStaticMarkup(createElement(SettingsForm, { view, onEdit: () => true, onReset: () => true, status: null }));
          const where = `Settings (${leagueType}, ${protectValue}, ${valuesEstimated ? "our estimates" : "FantasyCalc's values"})`;
          expectHidden(where, html);
          for (const s of stringsOf(view)) expectHidden(`${where}'s view`, s);
          if (view.protectValue) {
            protectHelps++;
            expect(view.protectValue.help, where).toContain("in projected points a week");
            expect(view.protectValue.help, where).not.toMatch(/\d/);
          }
        }
    // The help was read in every redraft case.
    expect(protectHelps).toBe(PROTECT_VALUE_LEVELS.length * 2);
  });

  it("the Import Report, with this league's FantasyCalc values in its model inputs", () => {
    const f = distinctive();
    const view = buildImportReport({ snapshot: f.snapshot, notes: [] }, { timeZone: "America/Chicago", model: f.inputs, freshModel: f.inputs });
    const html = renderToStaticMarkup(createElement(ReportView, { view, onPickTeam: noop }));
    expectHidden("the Import Report", html);
    for (const s of stringsOf(view)) expectHidden("the Import Report's view", s);
    expect(html).toContain("Values: FantasyCalc");
  });
});
