/**
 * What the trade pages keep while the tab stays in the app (finderMemory.ts; review of Phase 4: every return from the
 * Analyzer searched again, about 5 seconds, and lost the partner filter and the place in the list): the ideas each
 * search found, while they still hold (the worker's own rule: no kickoff since, the same deadline readings), the
 * Finder's address and sort, the idea to come back to, and one engine client for both pages.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { TradeSearchResult } from "@/engine/tradeModel";
import { contextStillValid } from "@/workers/freshness";
import {
  KEPT_SEARCHES,
  finderAddress,
  recallSearch,
  rememberFinderAddress,
  rememberReturn,
  rememberSearch,
  rememberSort,
  rememberedSort,
  resetFinderMemory,
  takeReturn,
  tradeEngine,
} from "./finderMemory";
import { searchResult } from "./testFixtures";

afterEach(() => resetFinderMemory());

const found = (label: string): TradeSearchResult => searchResult([], { notes: [label] });
const always = () => true;

/** Week 4's first kickoff (Thursday night), and Parker's deadline (Wed Dec 2, week 13). */
const THURSDAY = "2026-10-02T00:15:00.000Z";
const model = { nfl: { byeWeek: {}, kickoffs: { 4: { KC: THURSDAY } } } } as unknown as Pick<ModelInputs, "nfl">;
const snapshot = { currentWeek: 4, settings: { tradeDeadline: { week: 13, date: "2026-12-02T17:00:00.000Z" } } } as unknown as LeagueSnapshot;

describe("the ideas each search found", () => {
  it("are shown again for the same search while they hold, newest searches kept, at most KEPT_SEARCHES", () => {
    expect(recallSearch("a", always)).toBeNull();
    rememberSearch("a", "2026-10-01T16:00:00.000Z", found("a"));
    expect(recallSearch("a", always)?.notes).toEqual(["a"]);
    expect(recallSearch("b", always)).toBeNull();
    // A search again under the same key replaces its ideas.
    rememberSearch("a", "2026-10-01T17:00:00.000Z", found("a again"));
    expect(recallSearch("a", always)?.notes).toEqual(["a again"]);
    // Older searches give way to newer ones.
    for (let i = 0; i < KEPT_SEARCHES; i++) rememberSearch(`k${i}`, "2026-10-01T16:00:00.000Z", found(`k${i}`));
    expect(recallSearch("a", always)).toBeNull();
    expect(recallSearch("k0", always)?.notes).toEqual(["k0"]);
  });

  it("are forgotten once they no longer hold: a game kicked off since (the worker's own rule)", () => {
    const at = "2026-10-01T16:00:00.000Z";
    rememberSearch("a", at, found("a"));
    const holdsAt = (now: string) => (iso: string) => contextStillValid(Date.parse(iso), Date.parse(now), model, snapshot);
    // Later the same day: the same ideas.
    expect(recallSearch("a", holdsAt("2026-10-01T23:00:00.000Z"))?.notes).toEqual(["a"]);
    // After Thursday's kickoff: searched again, and the old ideas are gone for good.
    expect(recallSearch("a", holdsAt("2026-10-02T12:00:00.000Z"))).toBeNull();
    expect(recallSearch("a", always)).toBeNull();
  });
});

describe("the Finder's address, sort and place", () => {
  it("sends the Analyzer's back link to the Finder's last address, else the Finder for every team", () => {
    expect(finderAddress()).toBe("/trades");
    rememberFinderAddress("/trades?partner=9");
    expect(finderAddress()).toBe("/trades?partner=9");
  });

  it("keeps the sort the Finder was left in", () => {
    expect(rememberedSort()).toBeNull();
    rememberSort("helps");
    expect(rememberedSort()).toBe("helps");
  });

  it("gives back the idea whose Open in Analyzer was used once, and only to its own search", () => {
    rememberReturn("search", "2|give:105|get:203");
    expect(takeReturn("search")).toBe("2|give:105|get:203");
    expect(takeReturn("search")).toBeNull();
    rememberReturn("search", "x");
    expect(takeReturn("another search")).toBeNull();
    expect(takeReturn("search")).toBeNull();
  });
});

describe("tradeEngine", () => {
  it("is one client for both trade pages, made on first use and kept", () => {
    const a = tradeEngine();
    expect(tradeEngine()).toBe(a);
    resetFinderMemory();
    expect(tradeEngine()).toBe(a);
  });
});
