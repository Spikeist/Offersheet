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
import { settingsSummary } from "@/lib/tradeView";
import { FinderControls, THOROUGH_LABEL, searchKeyFor, thoroughHelp } from "./TradeFinderPage";
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
