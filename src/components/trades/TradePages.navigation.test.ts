/**
 * The trade pages read their address with useSearchParams (review of track F: on a next/link client navigation Next
 * updates window.location only when the navigation commits, so a page reading it while it first renders sees the
 * PREVIOUS address: "Open in Analyzer" opened an empty Analyzer, the League page's partner links opened the Finder for
 * every team). These tests mount each page while window.location still holds another address and useSearchParams
 * holds the new one, and check the page follows useSearchParams. And links that carry ids in their address are never
 * prefetched (prefetch={false}), so the server sees such an address only when the user opens it. And the trip between
 * the two pages (review of Phase 4): the Analyzer's "Back to the Trade Finder" goes to the Finder's last address,
 * partner included; a card's "Open in Analyzer" remembers the idea to come back to; the Analyzer's status line sits
 * above its form. Static renders (first render only) with the league store's state (Phase 4c: src/lib/leagueStore.ts,
 * leagueStoreStateOf) and Next's hooks faked; a made-up league.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ query: "", state: null as LeagueStoreState | null, links: [] as { href: string; prefetch: unknown; onClick?: () => void }[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(env.query), usePathname: () => "/trades" }));
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: unknown; children?: ReactNode; className?: string; onClick?: () => void }) => {
    env.links.push({ href, prefetch, ...(rest.onClick ? { onClick: rest.onClick } : {}) });
    return createElement("a", { ...rest, href }, children);
  },
}));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, useLeagueStoreState: () => env.state ?? actual.useLeagueStoreState() };
});

import { IMPORT_FORMAT_VERSION, type StoredImport } from "@/lib/importStore";
import { leagueStoreStateOf, savedLeagueId, type LeagueStoreState } from "@/lib/leagueStore";
import { buildLeagueView } from "@/lib/leagueView";
import { modelKey } from "@/lib/modelStore";
import { PROJECTIONS_SOURCE, buildFinderView, buildTradeCard } from "@/lib/tradeView";
import { NOW, leagueFixture } from "../league/testFixtures";
import { TradePartners } from "../league/TradePartners";
import { AnalyzerPage } from "./AnalyzerPage";
import { rememberFinderAddress, rememberReturn, resetFinderMemory, takeReturn, takeReturnTarget } from "./finderMemory";
import { TradeCard } from "./TradeCard";
import { FinderFrame, TradeFinderPage } from "./TradeFinderPage";
import { TRADE_MARKET, evaluation, searchResult, tradeSnapshot } from "./testFixtures";

const f = leagueFixture();
/** The saved league's id: the trade pages' memory is per league (finderMemory.ts). */
const LEAGUE = savedLeagueId(f.snapshot);

beforeEach(() => {
  env.links = [];
  // The saved league and fresh model inputs for it, as the League page leaves them in the league store.
  const savedAt = new Date().toISOString();
  const stored: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt, request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
  env.state = leagueStoreStateOf({
    imports: [stored],
    models: { [LEAGUE]: { version: 1, savedAt, key: modelKey(f.snapshot), snapshotFetchedAt: f.snapshot.fetchedAt, model: { ...f.inputs, builtAt: savedAt } } },
  });
  // The address the browser still shows: the page the user came from.
  vi.stubGlobal("window", { location: { pathname: "/league", search: "?partner=4&give=101&get=401" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFinderMemory();
  env.state = null;
});

/** The Finder's partner select's chosen option. */
const pickedPartner = (html: string) => /<select id="finder-partner"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1]?.match(/<option value="([^"]*)" selected="">/)?.[1];

describe("the pages follow useSearchParams, never window.location (client navigation)", () => {
  it("the Trade Finder picks the partner the new address names", () => {
    env.query = "partner=2";
    expect(pickedPartner(renderToStaticMarkup(createElement(TradeFinderPage)))).toBe("2");
    env.query = "partner=3";
    expect(pickedPartner(renderToStaticMarkup(createElement(TradeFinderPage)))).toBe("3");
    // No partner in the new address: every team, whatever the old one said.
    env.query = "";
    expect(pickedPartner(renderToStaticMarkup(createElement(TradeFinderPage)))).toBe("");
  });

  it("the Trade Analyzer builds the trade the new address carries", () => {
    env.query = "partner=2&give=105&get=203";
    const html = renderToStaticMarkup(createElement(AnalyzerPage));
    expect(html).toMatch(/<option value="2" selected="">Gravel Gophers<\/option>/);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain("You give Glimmer Oddfellow; you get Ignatius Fumblewick.");
    expect(html).not.toMatch(/<option value="4" selected="">/);
  });
});

describe("the Trade Finder's timing lines (planner reply to Checkpoint 7a, 5.3)", () => {
  it("reads when to look and how fresh the data is from the saved league's inputs, at the current time (review of Phase 7b)", () => {
    const HOUR = 3600_000;
    const now = Date.now();
    const savedAt = new Date(now).toISOString();
    // Trade values a little over 2 hours old, projections a little over 5 (the minute's margin keeps the words still).
    const model = {
      ...f.inputs,
      builtAt: savedAt,
      market: { ...TRADE_MARKET, fetchedAt: new Date(now - 2 * HOUR - 60_000).toISOString() },
      sources: [{ source: PROJECTIONS_SOURCE, fetchedAt: new Date(now - 5 * HOUR - 60_000).toISOString() }],
    };
    const stored: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt, request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
    env.state = leagueStoreStateOf({ imports: [stored], models: { [LEAGUE]: { version: 1, savedAt, key: modelKey(f.snapshot), snapshotFetchedAt: f.snapshot.fetchedAt, model } } });
    const text = renderToStaticMarkup(createElement(TradeFinderPage))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
    // The fixture league: week 12 of 14 before its week-13 deadline, its "no review" only assumed (no period reported).
    expect(text).toContain(
      "Best time to look: Tuesday or Wednesday, after Monday night's game. Trade values and projections have caught up with the weekend, and a trade still has time to clear your league's review before Thursday.",
    );
    expect(text).toContain("Trade values updated 2 hours ago · Projections updated 5 hours ago.");
  });
});

describe("links that carry ids are never prefetched", () => {
  it("the trade card's Open in Analyzer", () => {
    renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(evaluation(), { snapshot: tradeSnapshot() }), rank: 1, feedback: { outcome: null, report: null, version: null, versionKey: null, versionWords: null }, onFeedback: () => ({ ok: true as const }) }));
    expect(env.links.filter((l) => l.href.startsWith("/analyzer?"))).toEqual([{ href: "/analyzer?partner=2&give=106&get=204", prefetch: false }]);
  });

  it("Plan B's Open in Analyzer too (planner reply to Checkpoint 4, change 6)", () => {
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "105" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:105|get:203", b: 2, tradeScore: 28, pAccept: 0.4, pComplete: 0.4, acceptLabel: "Decent", overall: 13, kind: "otherTarget" as const };
    renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(evaluation({ planB }), { snapshot: tradeSnapshot() }), rank: 1, feedback: { outcome: null, report: null, version: null, versionKey: null, versionWords: null }, onFeedback: () => ({ ok: true as const }) }));
    // The card's own first, then its Plan B's (after the card's content since the review of Phase 4b), marked as one.
    expect(env.links.filter((l) => l.href.startsWith("/analyzer?"))).toEqual([
      { href: "/analyzer?partner=2&give=106&get=204", prefetch: false },
      { href: "/analyzer?partner=2&give=105&get=203&from=planB", prefetch: false },
    ]);
  });

  it("the League page's partner cards' Trade ideas", () => {
    renderToStaticMarkup(createElement(TradePartners, { view: buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW }) }));
    const finder = env.links.filter((l) => l.href.startsWith("/trades?"));
    expect(finder).toHaveLength(3);
    for (const l of finder) expect(l.prefetch).toBe(false);
  });
});

describe("the trip between the Trade Finder and the Analyzer (review of Phase 4)", () => {
  /** The Analyzer's "Back to the Trade Finder" link. */
  const backHref = (html: string) => /<a [^>]*href="([^"]*)"[^>]*>Back to the Trade Finder<\/a>/.exec(html)?.[1];

  it("goes back to the league's Finder's last address, its partner filter included, else to the Finder for every team", () => {
    env.query = "partner=2&give=105&get=203";
    expect(backHref(renderToStaticMarkup(createElement(AnalyzerPage)))).toBe("/trades");
    rememberFinderAddress(LEAGUE, "/trades?partner=4");
    expect(backHref(renderToStaticMarkup(createElement(AnalyzerPage)))).toBe("/trades?partner=4");
    // Another league's Finder address never: its partner is a team of that league (Phase 4c).
    resetFinderMemory();
    rememberFinderAddress("sleeper:12345678:2026", "/trades?partner=3");
    expect(backHref(renderToStaticMarkup(createElement(AnalyzerPage)))).toBe("/trades");
  });

  it("has the Analyzer's status line above its form, so the address's trade shows it's being evaluated near the top", () => {
    env.query = "partner=2&give=105&get=203";
    const html = renderToStaticMarkup(createElement(AnalyzerPage));
    const status = html.indexOf('<p role="status"');
    expect(status).toBeGreaterThan(html.indexOf("Back to the Trade Finder"));
    expect(status).toBeLessThan(html.indexOf("Who and what"));
  });

  it("passes the idea's key when its Open in Analyzer is used, and the Finder's memory gives it back once, for its own search", () => {
    const seen: string[] = [];
    const snap = tradeSnapshot();
    const found = buildFinderView({ result: searchResult([evaluation({ key: "a" }), evaluation({ key: "b", give: ["105"] })]), sort: "overall", snapshot: snap, partnerId: null });
    renderToStaticMarkup(
      createElement(FinderFrame, { state: { kind: "done", view: found }, teamName: null, controls: null, records: [], leagueKey: "espn:0000abcd", onFeedback: () => ({ ok: true as const }), onOpenAnalyzer: (key: string) => void seen.push(key) }),
    );
    const opens = env.links.filter((l) => l.href.startsWith("/analyzer?"));
    expect(opens.map((l) => l.prefetch)).toEqual([false, false]);
    for (const o of opens) o.onClick?.();
    expect(seen).toEqual(found.cards.map((c) => c.key));
    // finderMemory: the idea comes back once, and only to the search it was in.
    rememberReturn("search-key", "a");
    expect(takeReturn("another-search")).toBeNull();
    rememberReturn("search-key", "a");
    expect(takeReturn("search-key")).toBe("a");
    expect(takeReturn("search-key")).toBeNull();
  });

  it("remembers which of an idea's links was used, its own or its Plan B's, to bring that one back into view (Phase 4b)", () => {
    const seen: [string, string | undefined][] = [];
    const planB = { proposal: { partnerId: "2", give: [{ kind: "player" as const, id: "105" }], get: [{ kind: "player" as const, id: "203" }] }, key: "2|give:105|get:203", b: 2, tradeScore: 28, pAccept: 0.4, pComplete: 0.4, acceptLabel: "Decent", overall: 13, kind: "otherTarget" as const };
    const found = buildFinderView({ result: searchResult([evaluation({ key: "a", planB })]), sort: "overall", snapshot: tradeSnapshot(), partnerId: null });
    renderToStaticMarkup(
      createElement(FinderFrame, {
        state: { kind: "done", view: found },
        teamName: null,
        controls: null,
        records: [],
        leagueKey: "espn:0000abcd",
        onFeedback: () => ({ ok: true as const }),
        onOpenAnalyzer: (key: string, href?: string) => void seen.push([key, href]),
      }),
    );
    for (const o of env.links.filter((l) => l.href.startsWith("/analyzer?"))) o.onClick?.();
    expect(seen).toEqual([
      ["a", "/analyzer?partner=2&give=106&get=204"],
      ["a", "/analyzer?partner=2&give=105&get=203&from=planB"],
    ]);
    rememberReturn("search-key", "a", "/analyzer?partner=2&give=105&get=203&from=planB");
    expect(takeReturnTarget("search-key")).toEqual({ cardKey: "a", href: "/analyzer?partner=2&give=105&get=203&from=planB" });
    expect(takeReturnTarget("search-key")).toBeNull();
    rememberReturn("search-key", "a");
    expect(takeReturnTarget("search-key")).toEqual({ cardKey: "a", href: null });
  });
});
