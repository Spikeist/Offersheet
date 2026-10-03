/**
 * The trade pages read their address with useSearchParams (review of track F: on a next/link client navigation Next
 * updates window.location only when the navigation commits, so a page reading it while it first renders sees the
 * PREVIOUS address: "Open in Analyzer" opened an empty Analyzer, the League page's partner links opened the Finder for
 * every team). These tests mount each page while window.location still holds another address and useSearchParams
 * holds the new one, and check the page follows useSearchParams. And links that carry ids in their address are never
 * prefetched (prefetch={false}), so the server sees such an address only when the user opens it. And the trip between
 * the two pages (review of Phase 4): the Analyzer's "Back to the Trade Finder" goes to the Finder's last address,
 * partner included; a card's "Open in Analyzer" remembers the idea to come back to; the Analyzer's status line sits
 * above its form. Static renders (first render only) with this tab's storage, the browser's storage and Next's hooks
 * faked; a made-up league.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ query: "", session: new Map<string, string>(), links: [] as { href: string; prefetch: unknown; onClick?: () => void }[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(env.query), usePathname: () => "/trades" }));
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: unknown; children?: ReactNode; className?: string; onClick?: () => void }) => {
    env.links.push({ href, prefetch, ...(rest.onClick ? { onClick: rest.onClick } : {}) });
    return createElement("a", { ...rest, href }, children);
  },
}));
vi.mock("@/lib/useSessionValue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSessionValue")>()),
  useSessionValue: (key: string) => env.session.get(key) ?? null,
}));
vi.mock("@/components/settings/useLocalValue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/settings/useLocalValue")>()),
  useLocalValue: () => null,
}));

import { IMPORT_FORMAT_VERSION, IMPORT_STORAGE_KEY } from "@/lib/importStore";
import { buildLeagueView } from "@/lib/leagueView";
import { MODEL_STORAGE_KEY, modelKey } from "@/lib/modelStore";
import { buildFinderView, buildTradeCard } from "@/lib/tradeView";
import { NOW, leagueFixture } from "../league/testFixtures";
import { TradePartners } from "../league/TradePartners";
import { AnalyzerPage } from "./AnalyzerPage";
import { rememberFinderAddress, rememberReturn, resetFinderMemory, takeReturn } from "./finderMemory";
import { TradeCard } from "./TradeCard";
import { FinderFrame, TradeFinderPage } from "./TradeFinderPage";
import { evaluation, searchResult, tradeSnapshot } from "./testFixtures";

const f = leagueFixture();

beforeEach(() => {
  env.session.clear();
  env.links = [];
  // The import and fresh model inputs for it, as the League page leaves them in this tab.
  const savedAt = new Date().toISOString();
  env.session.set(IMPORT_STORAGE_KEY, JSON.stringify({ version: IMPORT_FORMAT_VERSION, savedAt, request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } }));
  env.session.set(MODEL_STORAGE_KEY, JSON.stringify({ version: 1, savedAt, key: modelKey(f.snapshot), snapshotFetchedAt: f.snapshot.fetchedAt, model: { ...f.inputs, builtAt: savedAt } }));
  // The address the browser still shows: the page the user came from.
  vi.stubGlobal("window", { location: { pathname: "/league", search: "?partner=4&give=101&get=401" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFinderMemory();
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

describe("links that carry ids are never prefetched", () => {
  it("the trade card's Open in Analyzer", () => {
    renderToStaticMarkup(createElement(TradeCard, { card: buildTradeCard(evaluation(), { snapshot: tradeSnapshot() }), rank: 1, feedback: { outcome: null, report: null }, onFeedback: () => ({ ok: true as const }) }));
    expect(env.links.filter((l) => l.href.startsWith("/analyzer?"))).toEqual([{ href: "/analyzer?partner=2&give=106&get=204", prefetch: false }]);
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

  it("goes back to the Finder's last address, its partner filter included, else to the Finder for every team", () => {
    env.query = "partner=2&give=105&get=203";
    expect(backHref(renderToStaticMarkup(createElement(AnalyzerPage)))).toBe("/trades");
    rememberFinderAddress("/trades?partner=4");
    expect(backHref(renderToStaticMarkup(createElement(AnalyzerPage)))).toBe("/trades?partner=4");
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
});
