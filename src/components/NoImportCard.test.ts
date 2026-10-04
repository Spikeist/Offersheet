/**
 * The pages when the league store holds no league this tab can read (CLAUDE.md §14; Phase 4c: leagues saved in this
 * browser, src/lib/leagueStore.ts), rendered statically with the store's state mocked (leagueStoreStateOf):
 * "No league imported yet" when none is saved, and, for a league saved by an earlier version of Offer Sheet (an older
 * IMPORT_FORMAT_VERSION), that Offer Sheet was updated, naming the league when it's a saved one and offering "Import
 * again" when its id is known. All link to the Connect page. Every name is made up.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_FORMAT_VERSION, OUTDATED_IMPORT_TEXT, OUTDATED_IMPORT_TITLE, type StoredImport } from "@/lib/importStore";
import { leagueStoreStateOf, savedLeagueOf, type LeagueStoreState } from "@/lib/leagueStore";
import { ImportReport } from "./import/ImportReport";
import { LeaguePage } from "./league/LeaguePage";
import { NO_IMPORT_TITLE, NoImportCard, outdatedText } from "./NoImportCard";
import { NOW, leagueFixture } from "./league/testFixtures";
import { AnalyzerPage } from "./trades/AnalyzerPage";
import { TradeFinderPage } from "./trades/TradeFinderPage";

/** The store's state the pages see: null = the real hook's (the server's: loading). */
const env = vi.hoisted(() => ({ state: null as LeagueStoreState | null }));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, useLeagueStoreState: () => env.state ?? actual.useLeagueStoreState() };
});
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/league", useRouter: () => ({ push: () => {} }) }));

const f = leagueFixture();
const current: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: NOW, request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
const league = savedLeagueOf(current, NOW);

const PAGES = { "the League page": LeaguePage, "the Import Report": ImportReport, "the Trade Finder": TradeFinderPage, "the Trade Analyzer": AnalyzerPage } as const;
const renderPage = (page: keyof typeof PAGES, state: LeagueStoreState) => {
  env.state = state;
  return renderToStaticMarkup(createElement(PAGES[page]));
};
const CONNECT = /<a class="[^"]*" href="\/connect">Connect your league<\/a>/;
const IMPORT_AGAIN = /<button type="button" class="[^"]*">Import again<\/button>/;

/** A state whose current league was saved by an earlier version (its import isn't readable here). */
function outdatedState(request: StoredImport["request"] | null): LeagueStoreState {
  const base = leagueStoreStateOf({ imports: [current] });
  return { ...base, imports: new Map([[league.id, { kind: "outdated", request }]]) };
}

afterEach(() => {
  env.state = null;
});

describe("a tab without a league the pages can read", () => {
  for (const page of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
    it(`${page}: says Offer Sheet was updated for a league saved by an earlier version, names it, and offers Import again`, () => {
      const html = renderPage(page, outdatedState(current.request));
      expect(html).toContain(`<h1 class="text-2xl font-black tracking-tight">${OUTDATED_IMPORT_TITLE}</h1>`);
      expect(html).toContain(`<p class="mt-2 text-muted">${outdatedText(league).replace(/'/g, "&#x27;")}</p>`);
      expect(html).toContain(f.snapshot.name);
      expect(html).toMatch(IMPORT_AGAIN);
      expect(html).toMatch(CONNECT);
      expect(html).not.toContain(NO_IMPORT_TITLE);
    });

    it(`${page}: says so for this tab's import from before the league store too (no saved league to name)`, () => {
      const html = renderPage(page, leagueStoreStateOf({ outdatedTabImport: { request: current.request } }));
      expect(html).toContain(`<p class="mt-2 text-muted">${OUTDATED_IMPORT_TEXT}</p>`);
      expect(html).toMatch(IMPORT_AGAIN);
      // Without a request that can be read: the Connect page only.
      const unreadable = renderPage(page, leagueStoreStateOf({ outdatedTabImport: { request: null } }));
      expect(unreadable).toContain(OUTDATED_IMPORT_TITLE);
      expect(unreadable).not.toMatch(IMPORT_AGAIN);
      expect(unreadable).toMatch(CONNECT);
    });

    it(`${page}: says no league is imported when none is saved, and that imports stay in this browser`, () => {
      const html = renderPage(page, leagueStoreStateOf({}));
      expect(html).toContain(`<h1 class="text-2xl font-black tracking-tight">${NO_IMPORT_TITLE}</h1>`);
      expect(html).toContain("Leagues you import stay saved in this browser until you remove them.");
      expect(html).not.toContain("browser tab only");
      expect(html).toMatch(CONNECT);
      expect(html).not.toContain(OUTDATED_IMPORT_TITLE);
    });

    it(`${page}: reads a league saved in this version's format`, () => {
      const html = renderPage(page, leagueStoreStateOf({ imports: [current] }));
      expect(html).not.toContain(NO_IMPORT_TITLE);
      expect(html).not.toContain(OUTDATED_IMPORT_TITLE);
    });
  }

  it("words the Offer Sheet update as one message: the heading, then what to do", () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const none = renderToStaticMarkup(createElement(NoImportCard, { read: { kind: "outdated", league: null, request: null }, text: "(the page's own words)" }));
    expect(text(none)).toBe("Offer Sheet was updated Import your league again to see the new numbers. Connect your league");
    const named = renderToStaticMarkup(createElement(NoImportCard, { read: { kind: "outdated", league, request: current.request }, text: "(the page's own words)" }));
    expect(text(named)).toBe(`Offer Sheet was updated ${outdatedText(league)} Import again Connect your league`.replace(/'/g, "&#x27;"));
    expect(renderToStaticMarkup(createElement(NoImportCard, { read: { kind: "none" }, text: "(the page's own words)" }))).toContain("(the page&#x27;s own words)");
  });

  it("names a saved league with its platform and season", () => {
    expect(outdatedText(league)).toBe(`Import ${f.snapshot.name} (ESPN 2026) again to see the new numbers.`);
    expect(outdatedText({ name: " ", platform: "sleeper", season: 2025 })).toBe("Import Sleeper league (Sleeper 2025) again to see the new numbers.");
  });
});
