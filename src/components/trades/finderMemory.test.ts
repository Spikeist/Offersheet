/**
 * What the trade pages keep while the tab stays in the app (finderMemory.ts; review of Phase 4: every return from the
 * Analyzer searched again, about 5 seconds, and lost the partner filter and the place in the list): the ideas each
 * search found, while they still hold (the worker's own rule: no kickoff since, the same deadline readings), the
 * Finder's address and sort, the idea to come back to, and one engine client for both pages. Phase 4c: per saved league
 * (planner reply to Checkpoint 4b, change 11), so nothing from one league shows in another, an address included: a trade
 * page reads only an address of the league it shows (useLeagueQuery's rule; review of track ML). Checkpoint 7h (the review of
 * its page): the Thorough search switch as each league's Finder was left, and how long each normal search took here (the
 * Thorough search's estimate scales it), both kept across the trip to the Analyzer.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { TradeSearchResult } from "@/engine/tradeModel";
import { contextStillValid } from "@/workers/freshness";
import {
  KEPT_SEARCHES,
  KEPT_SEARCH_TIMES,
  finderAddress,
  honoredQuery,
  queryOwnerAfter,
  recallSearch,
  recallSearchEntry,
  rememberFinderAddress,
  rememberOpened,
  rememberReturn,
  rememberSearch,
  rememberSearchTime,
  rememberSort,
  rememberThorough,
  rememberedSort,
  rememberedThorough,
  resetFinderMemory,
  searchTimeOf,
  takeReturn,
  takeReturnTarget,
  tradeEngine,
  type QueryOwner,
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

  it("come back with the moment they were for, and ideas re-filtered at another minimum chance replace them under the same key (Phase 4c)", () => {
    rememberSearch("a", "2026-10-01T16:00:00.000Z", found("at 10%"));
    expect(recallSearchEntry("a", always)).toEqual({ result: found("at 10%"), nowIso: "2026-10-01T16:00:00.000Z" });
    // The Finder keeps the re-filtered ideas under the search's key (it leaves the minimum out), for the re-filter's moment.
    rememberSearch("a", "2026-10-01T16:05:00.000Z", found("at 30%"));
    expect(recallSearchEntry("a", always)).toEqual({ result: found("at 30%"), nowIso: "2026-10-01T16:05:00.000Z" });
    expect(recallSearchEntry("a", () => false)).toBeNull();
    expect(recallSearchEntry("a", always)).toBeNull();
  });
});

describe("the Finder's address, sort and place", () => {
  const A = "espn:0000abcd:2026";
  const B = "sleeper:12345678:2026";

  it("sends the Analyzer's back link to the league's Finder's last address, else the Finder for every team; another league's never", () => {
    expect(finderAddress(A)).toBe("/trades");
    rememberFinderAddress(A, "/trades?partner=9");
    expect(finderAddress(A)).toBe("/trades?partner=9");
    // A partner is a team id of that league: another league's back link never takes it.
    expect(finderAddress(B)).toBe("/trades");
    rememberFinderAddress(B, "/trades?partner=2");
    expect(finderAddress(A)).toBe("/trades?partner=9");
  });

  it("keeps the sort each league's Finder was left in", () => {
    expect(rememberedSort(A)).toBeNull();
    rememberSort(A, "helps");
    expect(rememberedSort(A)).toBe("helps");
    expect(rememberedSort(B)).toBeNull();
    // Checkpoint 7c's "Helps both" (planner reply to Checkpoint 7b, §7) like any other: a return shows that list again.
    rememberSort(B, "helpsBoth");
    expect(rememberedSort(B)).toBe("helpsBoth");
    expect(rememberedSort(A)).toBe("helps");
  });

  it("keeps each league's Thorough search switch as its Finder was left (off by default, reset with everything else)", () => {
    expect(rememberedThorough(A)).toBe(false);
    rememberThorough(A, true);
    expect(rememberedThorough(A)).toBe(true);
    expect(rememberedThorough(B)).toBe(false);
    rememberThorough(B, true);
    rememberThorough(A, false);
    expect(rememberedThorough(A)).toBe(false);
    expect(rememberedThorough(B)).toBe(true);
    resetFinderMemory();
    expect(rememberedThorough(B)).toBe(false);
  });

  it("Open in Analyzer files the idea under its search and keeps the switch as that search had it (Checkpoint 7h)", () => {
    rememberThorough(A, false);
    rememberOpened(A, { key: "search|thorough", thorough: true }, "2|give:105|get:203", "/analyzer?partner=2&give=105&get=203&from=planB");
    expect(rememberedThorough(A)).toBe(true);
    expect(rememberedThorough(B)).toBe(false);
    expect(takeReturnTarget("search|thorough")).toEqual({ cardKey: "2|give:105|get:203", href: "/analyzer?partner=2&give=105&get=203&from=planB" });
    rememberOpened(A, { key: "search", thorough: false }, "x");
    expect(rememberedThorough(A)).toBe(false);
    expect(takeReturnTarget("search")).toEqual({ cardKey: "x", href: null });
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

describe("how long each normal search took here (the Thorough search's estimate; Checkpoint 7h)", () => {
  it("keeps a search's time by its key, the newest replacing it, and gives none for a key it never saw", () => {
    expect(searchTimeOf("a")).toBeNull();
    rememberSearchTime("a", 7000);
    expect(searchTimeOf("a")).toBe(7000);
    rememberSearchTime("a", 6500);
    expect(searchTimeOf("a")).toBe(6500);
    expect(searchTimeOf("b")).toBeNull();
  });

  it("ignores a time that isn't a positive number of milliseconds, so it never stands in for a search's", () => {
    rememberSearchTime("a", 7000);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) rememberSearchTime("a", bad);
    expect(searchTimeOf("a")).toBe(7000);
    rememberSearchTime("b", 0);
    expect(searchTimeOf("b")).toBeNull();
  });

  it("keeps the newest KEPT_SEARCH_TIMES keys, apart from the ideas (a re-filter replacing a search's ideas leaves its time), and forgets them on reset", () => {
    rememberSearch("a", "2026-10-01T16:00:00.000Z", found("a"));
    rememberSearchTime("a", 7000);
    // A re-filter's ideas under the same key: the page notes no time for it (its timings are the re-filter's few milliseconds).
    rememberSearch("a", "2026-10-01T16:05:00.000Z", found("a at 30%"));
    expect(searchTimeOf("a")).toBe(7000);
    for (let i = 0; i < KEPT_SEARCH_TIMES; i++) rememberSearchTime(`k${i}`, 1000 + i);
    expect(searchTimeOf("a")).toBeNull();
    expect(searchTimeOf("k0")).toBe(1000);
    resetFinderMemory();
    expect(searchTimeOf("k0")).toBeNull();
  });
});

describe("tradeEngine", () => {
  it("is one client for both trade pages of a league, made on first use and kept; another league gets its own", () => {
    const a = tradeEngine("espn:0000abcd:2026");
    expect(tradeEngine("espn:0000abcd:2026")).toBe(a);
    resetFinderMemory();
    expect(tradeEngine("espn:0000abcd:2026")).toBe(a);
    // Another league: the first one's client is stopped (src/lib/engineClient.ts createLeagueEngine), a new one made.
    const b = tradeEngine("sleeper:12345678:2026");
    expect(b).not.toBe(a);
    expect(tradeEngine("espn:0000abcd:2026")).not.toBe(a);
  });
});

describe("whose address it is (useLeagueQuery's rule; review of track ML)", () => {
  const A = "espn:0000abcd:2026";
  const B = "sleeper:12345678:2026";

  /** The page's renders, one per (address, league shown): what each reads, the owner carried from one to the next. */
  function renders(steps: readonly [query: string, leagueId: string | null][]): string[] {
    let owner: QueryOwner | null = null;
    return steps.map(([query, leagueId]) => {
      owner = queryOwnerAfter(owner, query, leagueId);
      return honoredQuery(owner, query, leagueId);
    });
  }

  it("reads an address the page opened, or wrote, under the league shown", () => {
    expect(renders([["partner=4", A]])).toEqual(["partner=4"]);
    // The page's own write (a partner picked), and a link followed, under the same league.
    expect(renders([["partner=4", A], ["partner=7", A], ["", A], ["partner=4", A]])).toEqual(["partner=4", "partner=7", "", "partner=4"]);
    // While no league is shown (the store loading) nothing is claimed: the first league shown gets it.
    expect(renders([["partner=4", null], ["partner=4", A]])).toEqual(["partner=4", "partner=4"]);
  });

  it("reads another league's address as none: a switch (before Next applies the switcher's drop), or a removal here or in another tab", () => {
    // Switched to B with A's address still there: none; then the address is dropped, and B's own address reads.
    expect(renders([["partner=4", A], ["partner=4", B], ["", B], ["partner=4", B]])).toEqual(["partner=4", "", "", "partner=4"]);
    // The address not dropped (a browser that refuses), and back to A: A's own again.
    expect(renders([["partner=4&give=101&get=401", A], ["partner=4&give=101&get=401", B], ["partner=4&give=101&get=401", A]])).toEqual(["partner=4&give=101&get=401", "", "partner=4&give=101&get=401"]);
    // A league removed while it showed no address: nothing to read either way.
    expect(renders([["", A], ["", B]])).toEqual(["", ""]);
  });
});
