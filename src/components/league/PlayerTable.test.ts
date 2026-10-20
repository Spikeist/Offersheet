/**
 * My roster card's lock and "Expected back" control, rendered statically (Checkpoint 7e; planner reply to Checkpoint 7d,
 * items 3.3 and 3.5; PlayerTable.tsx): with the League page's settings edits around the table (LeagueSettingsEditContext)
 * the lock sits beside each of my active and IR players and the return line is a labeled select reading the saved week (in his
 * breakdown since Checkpoint 7h, the week inline in his button);
 * without them, no lock and the line alone. 44 px targets, words for screen readers, and the conflict note's short line
 * giving way to the return line. From the fictional league in testFixtures.ts.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExpectedReturn } from "@/engine/leagueModel";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { buildLeagueView, type PlayerRow } from "@/lib/leagueView";
import { LeagueSettingsEditContext } from "./leagueSettingsEdit";
import { PlayerDetail, PlayerTable } from "./PlayerTable";
import { NOW, leagueFixture } from "./testFixtures";

const ESPN_15: ExpectedReturn = { week: 15, source: "platform", fallback: { week: 15, source: "platform" } };

/** My roster's rows (team 1), Fiddlesticks (IR) expected back in ESPN's week 15 and Crumpet (Questionable, a conflict note) in week 13 by our guess. */
function myRows(): PlayerRow[] {
  const f = leagueFixture();
  for (const [id, expected] of [
    ["107", ESPN_15],
    ["103", { week: 13, source: "model", fallback: { week: 13, source: "model" } }],
  ] as const) {
    const pm = f.model.players[id];
    if (!pm) throw new Error(`fixture player ${id} missing`);
    f.model.players[id] = { ...pm, expectedReturn: expected };
  }
  const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
  return view.rosters.find((r) => r.isMine)?.players ?? [];
}

const theirRows = (): PlayerRow[] => {
  const f = leagueFixture();
  return buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW }).rosters.find((r) => r.teamId === "2")?.players ?? [];
};

const table = (players: PlayerRow[]) => createElement(PlayerTable, { players, caption: "Roster", showLineupCost: true, split: true });
const SEASON = leagueFixture().snapshot.season;
const withEdits = (child: ReactElement, settings: TradeSettings) => createElement(LeagueSettingsEditContext, { value: { leagueKey: "test-league", settings, season: SEASON } }, child);
const SAVED: TradeSettings = { ...defaultTradeSettings(), untouchables: ["101"], returnWeeks: { "107": 14 }, returnWeeksSeason: SEASON };

describe("my roster card's lock (item 3.3)", () => {
  it("sits beside each of my active and IR players' buttons, 44 px, saying in words whether he's untouchable", () => {
    const html = renderToStaticMarkup(withEdits(table(myRows()), SAVED));
    const locks = [...html.matchAll(/<button type="button" aria-pressed="(true|false)" aria-label="([^"]+)" title="([^"]+)" data-untouchable-lock="([^"]+)"[^>]*class="([^"]*)"/g)];
    expect(locks).toHaveLength(9);
    expect(locks.every((m) => /(^|\s)size-11(\s|$)/.test(m[5] ?? ""))).toBe(true);
    // One name whichever way it's set, the state in aria-pressed, what pressing it does on hover (review of wave C, UI-C-10).
    const pressed = locks.find((m) => m[1] === "true");
    expect(pressed?.slice(2, 5)).toEqual(["Untouchable: Fizzwick Pemberton", "Fizzwick Pemberton is untouchable. Unlock him", "101"]);
    const fiddlesticks = locks.find((m) => m[4] === "107");
    expect(fiddlesticks?.slice(1, 4)).toEqual(["false", "Untouchable: Humbert Fiddlesticks", "Lock Humbert Fiddlesticks as untouchable"]);
    // The disclosure button gives the lock room (it no longer fills the cell's width).
    expect(html).toMatch(/<div class="flex items-start gap-1"><button type="button" aria-expanded="false" aria-controls="weeks-[^"]+" class="flex min-h-11 min-w-0 flex-1 flex-col/);
  });

  it("isn't there for another team's players, nor without the League page's settings edits", () => {
    expect(renderToStaticMarkup(withEdits(table(theirRows()), SAVED))).not.toContain("aria-pressed");
    const plain = renderToStaticMarkup(table(myRows()));
    expect(plain).not.toContain("aria-pressed");
    expect(plain).toMatch(/<th scope="row" class="p-0 [^"]*"><button type="button" aria-expanded="false" aria-controls="weeks-[^"]+" class="flex min-h-11 w-full flex-col/);
  });
});

describe("Expected back (item 3.5)", () => {
  const detailOf = (id: string, settings: TradeSettings = SAVED) => {
    const row = myRows().find((p) => p.id === id) as PlayerRow;
    return renderToStaticMarkup(withEdits(createElement(PlayerDetail, { player: row, showLineupCost: true }), settings));
  };

  it("is a labeled select in his breakdown, reading the saved week, 44 px with 16 px text (Checkpoint 7h: moved from a row of its own)", () => {
    const html = detailOf("107");
    const control = /<label for="([^"]+)" class="[^"]*">Expected back<span class="sr-only"> for Humbert Fiddlesticks<\/span>:<\/label><select id="\1" class="([^"]*)">([\s\S]*?)<\/select>/.exec(html);
    expect(control).not.toBeNull();
    expect(control?.[2]).toMatch(/(^|\s)min-h-11(\s|$)/);
    expect(control?.[2]).toMatch(/(^|\s)text-base(\s|$)/);
    const options = [...(control?.[3] ?? "").matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => [m[1], m[3], Boolean(m[2])]);
    // ESPN's own week isn't offered again (review of wave C, UI-C-5).
    expect(options).toEqual([
      ["", "week 15 (ESPN)", false],
      ["13", "week 13", false],
      ["14", "week 14 (your week)", true],
      ["16", "week 16", false],
      ["17", "week 17", false],
      ["30", "out for the season", false],
    ]);
    // Crumpet's own control, nothing saved: our guess chosen.
    expect(detailOf("103")).toMatch(/Expected back<span class="sr-only"> for Bartleby Crumpet<\/span>:<\/label><select id="[^"]+" class="[^"]*"><option value="" selected="">week 13 \(our guess\)<\/option>/);
    // A saved week from another season isn't shown as his (review of wave C, UI-C-3).
    expect(detailOf("107", { ...SAVED, returnWeeksSeason: SEASON - 1 })).toMatch(/for Humbert Fiddlesticks<\/span>:<\/label><select id="[^"]+" class="[^"]*"><option value="" selected="">week 15 \(ESPN\)<\/option>/);
  });

  it("shows the week inline in his button, his row header his button and lock alone, no select in the table until his breakdown opens (Checkpoint 7h; review of wave C, UI-C-10)", () => {
    const html = renderToStaticMarkup(withEdits(table(myRows()), SAVED));
    const headers = [...html.matchAll(/<th scope="row"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1] ?? "");
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h).not.toContain("<select");
    expect(html).not.toContain("<select");
    // The week in words in his button, where the conflict note's short line would be.
    expect(html).toContain('<span class="block pl-4 text-xs break-words text-muted">Expected back: week 15 (ESPN)</span>');
    // No row of its own under his.
    expect(html).not.toMatch(/<td colSpan="5" class="p-0"><span class="flex/);
  });

  it("is the line alone without the League page's settings edits, and replaces the conflict note's short line in his button", () => {
    const html = renderToStaticMarkup(table(myRows()));
    expect(html).not.toContain("<select");
    expect(html).toContain('<span class="block pl-4 text-xs break-words text-muted">Expected back: week 15 (ESPN)</span>');
    // Crumpet's button no longer says "ESPN says back wk 15; using Sleeper": his return line follows it.
    expect(html).not.toContain(">ESPN says back wk 15; using Sleeper</span>");
    expect(html).toContain("Expected back: week 13 (our guess)");
    // His breakdown without the edits: the line, no select.
    const detail = renderToStaticMarkup(createElement(PlayerDetail, { player: myRows().find((p) => p.id === "103") as PlayerRow, showLineupCost: true }));
    expect(detail).not.toContain("<select");
    expect(detail).toContain("Expected back: week 13 (our guess)");
  });

  it("opens at the top of his breakdown with its select (one per player: review of wave C, UI-C-5), how a week of the user's counts, and the conflict sentence stays", () => {
    const detail = detailOf("103");
    expect(detail).toContain("ESPN: questionable, return week 15");
    expect(detail.match(/<select/g)).toHaveLength(1);
    expect(detail).toContain("Pick the week you expect him back if you know better.");
    expect(detail.indexOf("<select")).toBeLessThan(detail.indexOf("Pick the week you expect him back"));
    const plain = renderToStaticMarkup(withEdits(createElement(PlayerDetail, { player: myRows().find((p) => p.id === "101") as PlayerRow, showLineupCost: true }), SAVED));
    expect(plain).not.toContain("Expected back");
  });
});
