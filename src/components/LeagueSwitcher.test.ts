/**
 * The league switcher at the top of every page and the storage banner under the header (CLAUDE.md §14; planner reply
 * to Checkpoint 4b, change 11), rendered statically with the league store's state mocked (leagueStoreStateOf): the
 * button names the league this tab shows (name, platform, season) and is a 44 px disclosure; the panel lists every
 * saved league with the one shown marked (not by color alone), Remove for each, the confirmation saying what goes, and
 * Add league; nothing shows while the store loads or with no league saved; the banner says when leagues can't be
 * kept. Every name is made up.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFeedback, type FeedbackRecord } from "@/lib/feedbackStore";
import { IMPORT_FORMAT_VERSION, type StoredImport } from "@/lib/importStore";
import { STORAGE_MEMORY_ONLY, STORAGE_UPDATED_ELSEWHERE, leagueStoreStateOf, savedLeagueId, savedLeagueOf, type LeagueStoreState, type SavedLeague } from "@/lib/leagueStore";
import { leagueKey } from "@/lib/settingsStore";
import { LeaguePanel, LeagueSwitcher, StorageNotice, leagueMeta, leagueName, removalText, removedText, savedLeagueLabel, type LeaguePanelProps } from "./LeagueSwitcher";
import { leagueFixture } from "./league/testFixtures";

const env = vi.hoisted(() => ({ state: null as LeagueStoreState | null }));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, useLeagueStoreState: () => env.state ?? actual.useLeagueStoreState() };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/league" }));

const f = leagueFixture();
const espn: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: "2026-10-04T12:00:00.000Z", request: { platform: "espn", season: 2026, leagueId: f.snapshot.leagueId }, response: { snapshot: f.snapshot, notes: [] } };
const sleeperSnap = { ...f.snapshot, platform: "sleeper" as const, leagueId: "123456789012345678", name: "Quasar Quokka Club", fetchedAt: "2026-10-04T12:05:00.000Z" };
const sleeper: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: "2026-10-04T12:05:00.000Z", request: { platform: "sleeper", season: 2026, leagueId: sleeperSnap.leagueId }, response: { snapshot: sleeperSnap, notes: [] } };
const lastYearSnap = { ...f.snapshot, season: 2025, fetchedAt: "2025-12-01T12:00:00.000Z" };
const lastYear: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: "2025-12-01T12:00:00.000Z", request: { platform: "espn", season: 2025, leagueId: f.snapshot.leagueId }, response: { snapshot: lastYearSnap, notes: [] } };

const ESPN_ID = savedLeagueId(f.snapshot);
const SLEEPER_ID = savedLeagueId(sleeperSnap);

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function render(state: LeagueStoreState | null, component: () => ReturnType<typeof createElement> = () => createElement(LeagueSwitcher)) {
  env.state = state;
  try {
    return renderToStaticMarkup(component());
  } finally {
    env.state = null;
  }
}

afterEach(() => {
  env.state = null;
});

describe("the league in words", () => {
  it("names a league by its name, else its platform, with the platform and season", () => {
    const league = savedLeagueOf(espn, espn.savedAt);
    expect(leagueName(league)).toBe(f.snapshot.name);
    expect(leagueMeta(league)).toBe("ESPN · 2026");
    expect(savedLeagueLabel(league)).toBe(`${f.snapshot.name} (ESPN 2026)`);
    expect(leagueName({ name: "  ", platform: "sleeper", season: 2026 })).toBe("Sleeper league");
  });

  it("says what a removal deletes: settings and feedback too, unless another saved season keeps them", () => {
    expect(removalText(0, null)).toBe("Its import, your team pick and its projections go, and so do its settings. You can import it again from the Connect page.");
    expect(removalText(3, null)).toBe("Its import, your team pick and its projections go, and so do its settings and your feedback on 3 trade ideas. You can import it again from the Connect page.");
    expect(removalText(2, 2025)).toBe("Its import, your team pick and its projections go. Its settings and feedback stay, since its 2025 season is saved too.");
    expect(removalText(0, 2025)).toBe("Its import, your team pick and its projections go. Its settings stay, since its 2025 season is saved too.");
  });

  it("says, once the league shown is removed, which league shows now (review of track ML)", () => {
    const alpha = { name: "Alpha League", platform: "espn" as const, season: 2026 };
    const bravo = { name: "Bravo League", platform: "sleeper" as const, season: 2026 };
    expect(removedText(alpha, bravo)).toBe("Removed Alpha League (ESPN 2026) from this browser. Now showing Bravo League (Sleeper 2026).");
    // Another league removed, or the last one: the tab's league doesn't change.
    expect(removedText(alpha, null)).toBe("Removed Alpha League (ESPN 2026) from this browser.");
  });
});

describe("LeagueSwitcher", () => {
  it("shows nothing but its empty status line while the store loads (the server) or with no league saved", () => {
    for (const state of [null, leagueStoreStateOf({})]) {
      const html = render(state);
      expect(html).toBe('<p role="status" class="sr-only"></p>');
    }
  });

  it("names the league this tab shows, with its platform and season, as a 44 px disclosure button, closed", () => {
    const html = render(leagueStoreStateOf({ imports: [espn, sleeper], currentId: SLEEPER_ID }));
    const button = /<button type="button" aria-expanded="false" class="([^"]*)">([\s\S]*?)<\/button>/.exec(html);
    expect(button?.[1]).toContain("min-h-11");
    expect(textOf(button?.[2] ?? "")).toBe("League: Quasar Quokka Club , Sleeper · 2026 (switch leagues)");
    expect(html).toContain("data-league-switcher");
    // Closed: no panel, no aria-controls pointing at nothing.
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain("Your leagues");
  });
});

describe("LeaguePanel", () => {
  const leagues: SavedLeague[] = [savedLeagueOf(espn, espn.savedAt), savedLeagueOf(sleeper, sleeper.savedAt)];
  const noop = () => {};
  const props: LeaguePanelProps = { id: "panel", leagues, currentId: ESPN_ID, feedback: [], confirmId: null, removing: false, error: null, onSwitch: noop, onAskRemove: noop, onKeep: noop, onRemove: noop, onAdd: noop };
  const panel = (over: Partial<LeaguePanelProps> = {}) => renderToStaticMarkup(createElement(LeaguePanel, { ...props, ...over }));
  const records = ["t1", "t2"].reduce<FeedbackRecord[]>(
    (list, key) =>
      applyFeedback(list, {
        leagueKey: leagueKey(f.snapshot),
        evaluation: { key, proposal: { partnerId: "2", give: [], get: [] }, features: { g: 0, n: 0, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: 0 }, b: 1, tradeScore: 15, pAccept: 0.3, pComplete: 0.3, overall: 5, dPO: 0, dCH: 0, dPPW: 0, gMine: 0, gPartner: 0 },
        change: { outcome: "sent" },
        at: "2026-10-04T13:00:00.000Z",
      }),
    [],
  );

  it("lists every saved league, the one shown marked with aria-current and a check mark, each with its own Remove", () => {
    const html = panel();
    const switches = [...html.matchAll(/<button type="button" data-league-id="([^"]+)"( aria-current="true")? class="([^"]*)">([\s\S]*?)<\/button>/g)].map(([, id, current, cls = "", inner = ""]) => ({
      id,
      current: !!current,
      cls,
      text: textOf(inner),
    }));
    expect(switches.map((s) => [s.id, s.current, s.text])).toEqual([
      [ESPN_ID, true, `✓ ${f.snapshot.name} ESPN · 2026 · showing now`],
      [SLEEPER_ID, false, "Quasar Quokka Club Sleeper · 2026"],
    ]);
    for (const s of switches) expect(s.cls).toContain("min-h-11");
    const removes = [...html.matchAll(/<button type="button" data-remove-league="([^"]+)" class="([^"]*)">([\s\S]*?)<\/button>/g)].map(([, id, cls = "", inner = ""]) => ({ id, cls, text: textOf(inner) }));
    expect(removes.map((r) => [r.id, r.text])).toEqual([
      [ESPN_ID, `Remove ${f.snapshot.name} (ESPN 2026)`],
      [SLEEPER_ID, "Remove Quasar Quokka Club (Sleeper 2026)"],
    ]);
    for (const r of removes) expect(r.cls).toContain("min-h-11");
    expect(html).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/connect">Add league<\/a>/);
    expect(html).toMatch(/<p id="([^"]+)" class="[^"]*">Your leagues<\/p><ul aria-labelledby="\1"/);
  });

  it("gives its focus rings the focus color, not the navy header's bright gold", () => {
    expect(panel()).toContain('style="--accent:var(--focus)"');
  });

  it("asks before removing, says what goes and offers to export the feedback that would go", () => {
    const html = panel({ confirmId: ESPN_ID, feedback: records });
    const question = /<div role="group" aria-labelledby="([^"]+)" class="[^"]*"><p id="\1" tabindex="-1" class="[^"]*">([\s\S]*?)<\/p>/.exec(html);
    expect(textOf(question?.[2] ?? "")).toBe(`Remove ${f.snapshot.name} (ESPN 2026) from this browser?`);
    expect(textOf(html)).toContain(removalText(2, null));
    const buttons = [...html.matchAll(/<button type="button"(?: aria-disabled="true")? class="([^"]*)">([^<]*)<\/button>/g)].map(([, cls = "", text]) => ({ cls, text }));
    expect(buttons.map((b) => b.text)).toEqual(["Export its feedback first", "Yes, remove it", "Keep it"]);
    for (const b of buttons) expect(b.cls).toContain("min-h-11");
  });

  it("keeps the settings and feedback when another season of the league is saved, and offers no export then", () => {
    const withLastYear = [...leagues, savedLeagueOf(lastYear, lastYear.savedAt)];
    const html = panel({ leagues: withLastYear, confirmId: ESPN_ID, feedback: records });
    expect(textOf(html)).toContain(removalText(2, 2025));
    expect(html).not.toContain("Export its feedback first");
  });

  it("says why a removal didn't happen, and keeps the confirmation's buttons", () => {
    const html = panel({ confirmId: SLEEPER_ID, error: "Your browser wouldn't let Offer Sheet remove this league." });
    expect(html).toMatch(/<p role="alert" class="[^"]*">Your browser wouldn&#x27;t let Offer Sheet remove this league\.<\/p>/);
    expect(html).toContain("Yes, remove it");
    // While it works, the button stays focusable and says so.
    expect(panel({ confirmId: SLEEPER_ID, removing: true })).toMatch(/<button type="button" aria-disabled="true" class="[^"]*">Removing…<\/button>/);
  });
});

describe("StorageNotice", () => {
  it("says nothing while leagues are kept in IndexedDB (or the store loads)", () => {
    expect(render(leagueStoreStateOf({}), () => createElement(StorageNotice))).toBe("");
    expect(render(null, () => createElement(StorageNotice))).toBe("");
  });

  it("says when leagues last only until the page closes, and when the page must be reloaded (with a 44 px Reload)", () => {
    const memory = render(leagueStoreStateOf({ storage: { kind: "memory", message: STORAGE_MEMORY_ONLY } }), () => createElement(StorageNotice));
    expect(memory).toMatch(/^<div role="status"/);
    expect(textOf(memory)).toBe(textOf(STORAGE_MEMORY_ONLY));
    const closed = render(leagueStoreStateOf({ storage: { kind: "closed", message: STORAGE_UPDATED_ELSEWHERE } }), () => createElement(StorageNotice));
    expect(closed).toMatch(/^<div role="alert"/);
    expect(closed).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Reload<\/button>/);
  });
});
