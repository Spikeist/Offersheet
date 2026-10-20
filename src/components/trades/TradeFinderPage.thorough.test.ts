/**
 * The Trade Finder's "Thorough search" switch (Checkpoint 7h; planner reply to Checkpoint 7g, section 3; TradeFinderPage.tsx's
 * header): off by default and not saved, a search key of its own (so its ideas are kept for the session apart from the normal
 * search's), and before it starts, roughly how long it takes (engine thorough.ts thoroughSeconds).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { defaultTradeSettings } from "@/engine/settings";
import { thoroughSeconds, thoroughSettings } from "@/engine/thorough";
import type { TradeSearchStage } from "@/engine/tradeModel";
import { progressView, settingsSummary, stageWeights } from "@/lib/tradeView";
import { HowToRead, THOROUGH_HEADING, thoroughWords } from "./HowToRead";
import { FinderControls, THOROUGH_LABEL, refilterProgress, searchKeyFor, thoroughHelp } from "./TradeFinderPage";
import { tradeSnapshot } from "./testFixtures";

const snapshot = tradeSnapshot();
const noop = () => undefined;
const base = { snapshot, builtAt: "2026-10-01T12:00:00.000Z", myTeamId: "1", settings: defaultTradeSettings(), partnerId: null };

describe("the Thorough search's key", () => {
  it("is the normal key with a mark of its own; off or absent, the normal key as before", () => {
    const normal = searchKeyFor(base);
    expect(searchKeyFor({ ...base, thorough: false })).toBe(normal);
    expect(searchKeyFor({ ...base, thorough: true })).toBe(`${normal}|thorough`);
    // The minimum chance still re-filters, never searches.
    expect(searchKeyFor({ ...base, thorough: true, settings: { ...base.settings, minChance: 0.5 } })).toBe(`${normal}|thorough`);
  });
});

describe("thoroughSeconds: roughly how long it takes", () => {
  const e = config.search.thorough.estimate;
  it("the normal search's time here × the work ratio, rounded up to the step", () => {
    expect(thoroughSeconds(7000, 9)).toBe(Math.ceil((7 * e.workRatio) / e.roundTo) * e.roundTo);
    expect(thoroughSeconds(6600, 11) % e.roundTo).toBe(0);
  });
  it("without one, a default rate for each team searched; never below one step", () => {
    expect(thoroughSeconds(null, 11)).toBe(Math.ceil((11 * e.secondsPerPartner) / e.roundTo) * e.roundTo);
    expect(thoroughSeconds(undefined, 1)).toBeGreaterThanOrEqual(e.roundTo);
    expect(thoroughSeconds(0, 9)).toBe(thoroughSeconds(null, 9));
    expect(thoroughSeconds(Number.NaN, 9)).toBe(thoroughSeconds(null, 9));
    expect(thoroughSeconds(10, 9)).toBe(e.roundTo);
  });

  it("one partner by its own scale (the review of Checkpoint 7h's page, thoroughui#3): a lower ratio, and a default near one partner's search", () => {
    // A one-partner normal search is mostly work that doesn't grow with the search, so its ratio is the lower one.
    expect(e.onePartner.workRatio).toBeLessThan(e.workRatio);
    expect(thoroughSeconds(2990, 1)).toBe(Math.ceil((2.99 * e.onePartner.workRatio) / e.roundTo) * e.roundTo);
    expect(thoroughSeconds(1400, 1)).toBe(Math.ceil((1.4 * e.onePartner.workRatio) / e.roundTo) * e.roundTo);
    expect(thoroughSeconds(null, 1)).toBe(Math.ceil(e.onePartner.seconds / e.roundTo) * e.roundTo);
    // The reviewer's cases on Parker's 12-team league (Node): a 2.99 s normal search for Team 1 read "about 20 seconds" for a
    // 9.08 s Thorough search, and without a normal time "about 5 seconds"; a 1.40 s one for Team 3, "about 10 seconds" for 5.93 s.
    expect(thoroughSeconds(2990, 1)).toBe(15);
    expect(thoroughSeconds(null, 1)).toBe(10);
    expect(thoroughSeconds(1400, 1)).toBe(10);
    // Every team's estimate is as before (a 7 s normal search, 9 partners: 45; without one, 5 s a partner).
    expect(thoroughSeconds(7000, 9)).toBe(45);
    expect(thoroughSeconds(null, 9)).toBe(45);
    // A partner count that isn't a whole number of teams reads as one partner.
    expect(thoroughSeconds(null, 0)).toBe(thoroughSeconds(null, 1));
    expect(thoroughSeconds(null, Number.NaN)).toBe(thoroughSeconds(null, 1));
  });

  it("measured: within about 0.9–2 times what one partner's Thorough search took on Parker's two leagues", () => {
    // The 20 partners of his two leagues, Oct 15 (Node: the one-partner normal search, then the Thorough one right after it;
    // data-local measurements, the config's comment), at the browser's ×1.24.
    const runs: [normal: number, thorough: number][] = [
      [3.05, 8.43], [1.57, 6.56], [1.26, 5.5], [1.23, 5.58], [1.53, 5.82], [1.12, 5.29], [1.66, 6.08], [2.86, 6.42], [1.53, 5.64], [1.53, 5.89], [1.31, 6.43],
      [1.14, 6.07], [2.11, 6.97], [1.58, 7.03], [2.0, 8.04], [1.03, 7.02], [1.86, 8.54], [2.15, 8.89], [1.57, 7.06], [1.27, 7.41],
    ];
    for (const [normal, thorough] of runs) {
      const ratio = thoroughSeconds(normal * 1.24 * 1000, 1) / (thorough * 1.24);
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(2);
      const without = thoroughSeconds(null, 1) / (thorough * 1.24);
      expect(without).toBeGreaterThan(0.9);
      expect(without).toBeLessThan(1.6);
    }
  });
});

describe("FinderControls: the Thorough search switch", () => {
  const props = { snapshot, myTeamId: "1", partnerId: null, onPartner: noop, sort: "overall" as const, onSort: noop, minChance: 0.1, onMinChance: noop, summary: settingsSummary(defaultTradeSettings(), "espn") };

  it("isn't there without its handler (an older caller)", () => {
    expect(renderToStaticMarkup(createElement(FinderControls, props))).not.toContain(THOROUGH_LABEL);
  });

  it("is a labeled 44 px switch, off by default, its help (what it does and about how long) read with it", () => {
    const html = renderToStaticMarkup(createElement(FinderControls, { ...props, thorough: false, onThorough: noop, thoroughSeconds: 45 }));
    const sw = /<label class="([^"]*)"><input type="checkbox" role="switch" aria-describedby="([^"]+)" class="[^"]*"\/>Thorough search<\/label>/.exec(html);
    expect(sw).not.toBeNull();
    expect(sw?.[1]).toContain("min-h-11");
    expect(html).toContain(`<p id="${sw?.[2]}" class="text-xs text-muted">${thoroughHelp(45)}</p>`);
    expect(thoroughHelp(45)).toBe("Checks every trade of up to 2 players a side with every team, plus trades with 3 players a side, and plays out more of them. Takes about 45 seconds.");
    const on = renderToStaticMarkup(createElement(FinderControls, { ...props, thorough: true, onThorough: noop, thoroughSeconds: 45 }));
    expect(on).toMatch(/role="switch" aria-describedby="[^"]+" class="[^"]*" checked=""\/>/);
  });

  it("the settings line says what the Thorough search lets a trade be (3 players a side)", () => {
    const s = defaultTradeSettings();
    expect(settingsSummary(thoroughSettings(s), "espn")).not.toBe(settingsSummary(s, "espn"));
    expect(settingsSummary(thoroughSettings(s), "espn")).toContain("3");
  });
});

describe("the Thorough search's progress bar (its own stage weights)", () => {
  const stages: TradeSearchStage[] = ["setup", "screening", "exact", "simScreen", "simFinal", "rank"];
  const sum = (w: Record<TradeSearchStage, number>) => stages.reduce((t, st) => t + w[st], 0);

  it("each search's weights add up to the whole bar; screening gets most of a Thorough search's (its measured share), under a third of a normal one's", () => {
    expect(sum(stageWeights("normal"))).toBeCloseTo(1, 9);
    expect(sum(stageWeights("thorough"))).toBeCloseTo(1, 9);
    expect(stageWeights()).toEqual(stageWeights("normal"));
    expect(stageWeights("normal")).toEqual({ setup: 0.08, screening: 0.3, exact: 0.2, simScreen: 0.11, simFinal: 0.14, rank: 0.17 });
    expect(stageWeights("thorough")).toEqual({ setup: 0.01, screening: 0.6, exact: 0.13, simScreen: 0.12, simFinal: 0.06, rank: 0.08 });
    expect(stageWeights("thorough").screening).toBeGreaterThan(0.45);
    expect(stageWeights("thorough").screening).toBeGreaterThan(2 * stageWeights("thorough").exact);
  });

  it("moves through the stages by those weights, forward only, the normal search's bar as before", () => {
    const w = stageWeights("thorough");
    let last = -1;
    for (const stage of stages) {
      for (const done of [0, 5, 10]) {
        const pct = progressView({ stage, done, total: 10 }, "search", "thorough").percent;
        expect(pct).toBeGreaterThanOrEqual(last);
        last = pct;
      }
    }
    expect(progressView({ stage: "screening", done: 5, total: 10 }, "search", "thorough").percent).toBe(Math.floor((w.setup + w.screening / 2) * 100));
    expect(progressView({ stage: "exact", done: 0, total: 10 }, "search", "thorough").percent).toBe(Math.floor((w.setup + w.screening) * 100));
    expect(progressView({ stage: "rank", done: 1, total: 1 }, "search", "thorough").percent).toBe(99);
    // The normal search's and a re-filter's bars don't change.
    expect(progressView({ stage: "exact", done: 0, total: 200 }).percent).toBe(38);
    expect(progressView({ stage: "screening", done: 5, total: 10 }, "search", "normal")).toEqual(progressView({ stage: "screening", done: 5, total: 10 }));
    expect(progressView({ stage: "rank", done: 5, total: 10 }, "refilter", "thorough")).toEqual(progressView({ stage: "rank", done: 5, total: 10 }, "refilter"));
    // Labels and details are the same either way.
    const a = progressView({ stage: "exact", done: 3, total: 12 }, "search", "thorough");
    const b = progressView({ stage: "exact", done: 3, total: 12 });
    expect({ ...a, percent: 0 }).toEqual({ ...b, percent: 0 });
  });

  it("a Thorough search's re-filter that searches afresh uses the Thorough weights; a normal one's, the normal ones", () => {
    const p = { stage: "screening" as const, done: 5, total: 10 };
    expect(refilterProgress(true)(p).view).toEqual(progressView(p, "search", "thorough"));
    expect(refilterProgress(false)(p).view).toEqual(progressView(p));
    expect(refilterProgress()(p).view).toEqual(progressView(p));
    expect(refilterProgress(true)({ stage: "rank", done: 5, total: 10 }).view.percent).toBe(50);
  });
});

describe("How to read: the Thorough search's paragraph (the Trade Finder's only)", () => {
  const read = (page: "finder" | "analyzer") => renderToStaticMarkup(createElement(HowToRead, { page })).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("says what it adds, about how long, that its ideas stay for the visit and that the switch isn't saved, its numbers from config", () => {
    const t = config.search.thorough;
    const words = thoroughWords();
    expect(THOROUGH_HEADING).toBe(THOROUGH_LABEL);
    expect(words).toContain("every trade of up to 2 players a side with every team, from whole rosters");
    expect(words).toContain(`trades with ${t.maxPerSide} players on a side from your ${t.threePool} and their ${t.threePool} best players`);
    expect(words).toContain(`plays out the best ${t.finalists} ideas where the usual search plays out ${config.search.finalists}`);
    // About how long by both of the switch's estimates, one partner's ratio to every team's (the second review of Checkpoint 7h's
    // page: "about 6 times as long", every team's alone, beside a one-partner switch that says 4 times its normal search).
    expect(t.estimate.onePartner.workRatio).toBeLessThan(t.estimate.workRatio);
    expect(words).toContain(`It takes about ${t.estimate.onePartner.workRatio} to ${t.estimate.workRatio} times as long (the switch says about how many seconds before it starts)`);
    expect(words).not.toContain(`about ${t.estimate.workRatio} times as long`);
    expect(words).toContain("Its ideas stay for this visit");
    expect(words).toContain("The switch isn't saved");
    // The review of Checkpoint 7h's page: this tab keeps it as left (the trip to the Analyzer included), never "always" the usual search.
    expect(words).toContain("this tab keeps it as you left it (coming back from the Analyzer too), and a new tab or a reload starts with the usual search");
    expect(words).not.toContain("always starts with the usual search");
    expect(words).not.toMatch(/goals?/i);
    expect(read("finder")).toContain(`${THOROUGH_HEADING} ${words}`);
    expect(read("analyzer")).not.toContain(words);
  });
});
