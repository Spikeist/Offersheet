/**
 * The Import Report and the League page when this tab holds no import they can read (CLAUDE.md §14),
 * rendered statically with the tab's sessionStorage faked (useSessionValue): "No league imported yet"
 * when there's none, and, for an import saved by an earlier version of Offer Sheet (an older
 * IMPORT_FORMAT_VERSION), that Offer Sheet was updated and the league needs importing again. Both link
 * to the Connect page. Every name is made up.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_FORMAT_VERSION, IMPORT_STORAGE_KEY, OUTDATED_IMPORT_TEXT, OUTDATED_IMPORT_TITLE, type StoredImport } from "@/lib/importStore";
import { ImportReport } from "./import/ImportReport";
import { LeaguePage } from "./league/LeaguePage";
import { NO_IMPORT_TITLE, NoImportCard } from "./NoImportCard";
import { NOW, leagueFixture } from "./league/testFixtures";

/** This tab's sessionStorage, as the pages read it (null = nothing stored). */
const session = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("@/lib/useSessionValue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSessionValue")>()),
  useSessionValue: (key: string) => session.values.get(key) ?? null,
}));

const f = leagueFixture();
const current: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: NOW, request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
/** The same import as Phases 1–2 saved it: format version 1, matchups without `decided` or `result`. */
const v1 = {
  ...current,
  version: 1,
  response: { ...current.response, snapshot: { ...f.snapshot, schedule: f.snapshot.schedule.map((m) => ({ week: m.week, teamA: m.teamA, teamB: m.teamB, isPlayoff: m.isPlayoff })) } },
};

const PAGES = { "the League page": LeaguePage, "the Import Report": ImportReport } as const;
const renderPage = (page: keyof typeof PAGES, stored: unknown) => {
  session.values.clear();
  if (stored !== undefined) session.values.set(IMPORT_STORAGE_KEY, JSON.stringify(stored));
  return renderToStaticMarkup(createElement(PAGES[page]));
};
const CONNECT = /<a class="[^"]*" href="\/connect">Connect your league<\/a>/;

afterEach(() => session.values.clear());

describe("a tab without an import the pages can read", () => {
  for (const page of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
    it(`${page}: says Offer Sheet was updated when the import is from an earlier version, and asks for the league again`, () => {
      const html = renderPage(page, v1);
      expect(html).toContain(`<h1 class="text-2xl font-black tracking-tight">${OUTDATED_IMPORT_TITLE}</h1>`);
      expect(html).toContain(`<p class="mt-2 text-muted">${OUTDATED_IMPORT_TEXT}</p>`);
      expect(html).toMatch(CONNECT);
      expect(html).not.toContain(NO_IMPORT_TITLE);
    });

    it(`${page}: says no league is imported when there's none (or nothing that is one)`, () => {
      for (const stored of [undefined, { version: 1 }, { ...current, version: IMPORT_FORMAT_VERSION + 1 }]) {
        const html = renderPage(page, stored);
        expect(html, JSON.stringify(stored)).toContain(`<h1 class="text-2xl font-black tracking-tight">${NO_IMPORT_TITLE}</h1>`);
        expect(html).toMatch(CONNECT);
        expect(html).not.toContain(OUTDATED_IMPORT_TITLE);
      }
    });

    it(`${page}: reads an import in this version's format`, () => {
      const html = renderPage(page, current);
      expect(html).not.toContain(NO_IMPORT_TITLE);
      expect(html).not.toContain(OUTDATED_IMPORT_TITLE);
      expect(html).toContain(f.snapshot.name);
    });
  }

  it("words the Offer Sheet update as one message: the heading, then what to do", () => {
    const html = renderToStaticMarkup(createElement(NoImportCard, { outdated: true, text: "(the page's own words)" }));
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe("Offer Sheet was updated Import your league again to see the new numbers. Connect your league");
    expect(renderToStaticMarkup(createElement(NoImportCard, { outdated: false, text: "(the page's own words)" }))).toContain("(the page&#x27;s own words)");
  });
});
