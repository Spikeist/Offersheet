/**
 * check:browser's League step on the page's parts closed by default (Checkpoint 7h, the integration's track "league": toward
 * "about 8 screens", the positional-strength heatmap and Best available closed under their headings, my roster card closed like
 * the others): the contract (contracts.ts leagueSectionsProblems) on the page as it opens, after the step's taps and after it
 * closes them again; the reader and the tap expressions compile with the page helpers; and the page's own markup carries what
 * they look for (LeagueView.tsx, DisclosureCard.tsx: each card's heading button with data-league-disclosure and aria-controls
 * naming its body, Best available's "Show all" with data-free-agents-all, my roster's summary with the You badge). The step's
 * functions themselves (steps.ts openLeagueSections, closeLeagueSections) were run in headless Chrome on the real LeagueView of
 * Parker's league offline (the integration's notes).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeagueView } from "@/components/league/LeagueView";
import { NOW, leagueFixture } from "@/components/league/testFixtures";
import { config } from "@/engine/config";
import { buildLeagueView } from "@/lib/leagueView";
import { LEAGUE_DISCLOSURES, leagueSectionsProblems, type LeagueSectionsRead } from "./contracts";
import { CARD_HELPERS, FREE_AGENTS_ALL, MY_ROSTER_SUMMARY, PAGE_HELPERS, READ_LEAGUE_SECTIONS, leagueDisclosure } from "./inPage";

const card = (key: string, heading: string, open: boolean, over: Partial<LeagueSectionsRead["disclosures"][number]> = {}) => ({ key, heading, expanded: open, shown: open, focused: false, height: 44, ...over });
const read = (open: boolean, over: Partial<LeagueSectionsRead> = {}): LeagueSectionsRead => ({
  disclosures: [card("heatmap", "Positional strength", open), card("free-agents", "Best available", open)],
  myRoster: { open },
  showAll: { expanded: open, text: open ? "Show fewer" : "Show all 30" },
  height: 7_078,
  ...over,
});

describe("leagueSectionsProblems (Checkpoint 7h)", () => {
  it("passes the page as it opens (everything closed) and after the step's taps (everything open)", () => {
    expect(leagueSectionsProblems(read(false), "closed", true)).toEqual([]);
    expect(leagueSectionsProblems(read(true), "open", true)).toEqual([]);
    // No team picked: no roster card of mine, and none is needed; every position fits: no Show all.
    expect(leagueSectionsProblems(read(false, { myRoster: null, showAll: null }), "closed", false)).toEqual([]);
    expect(leagueSectionsProblems(read(true, { myRoster: null, showAll: null }), "open", false)).toEqual([]);
  });

  it("fails a card open on arrival, or not opened by the step", () => {
    expect(leagueSectionsProblems(read(false, { disclosures: [card("heatmap", "Positional strength", true), card("free-agents", "Best available", false)] }), "closed", true)).toEqual([
      "“Positional strength” is open (it should be closed by default)",
    ]);
    expect(leagueSectionsProblems(read(true, { disclosures: [card("heatmap", "Positional strength", true), card("free-agents", "Best available", false)] }), "open", true)).toEqual(["“Best available” didn't open"]);
  });

  it("fails a missing card, a heading in other words, a control under 44 px, and a control that says one thing while its body shows another", () => {
    expect(leagueSectionsProblems(read(false, { disclosures: [card("free-agents", "Best available", false)] }), "closed", true)).toEqual([
      "no “Positional strength” card with its own control (button[data-league-disclosure=\"heatmap\"])",
    ]);
    expect(leagueSectionsProblems(read(false, { disclosures: [card("heatmap", "Strength", false), card("free-agents", "Best available", false, { height: 30 })] }), "closed", true)).toEqual([
      "the “heatmap” card's heading reads “Strength”, not “Positional strength”",
      "“Best available”'s control is 30 px tall (44 at least)",
    ]);
    expect(leagueSectionsProblems(read(false, { disclosures: [card("heatmap", "Positional strength", false, { shown: true }), card("free-agents", "Best available", true, { shown: false })] }), "closed", true)).toEqual([
      "“Positional strength” says it's closed, but its body is shown",
      "“Best available” says it's open, but its body is hidden",
    ]);
  });

  it("fails my roster card open on arrival, not opened, or missing when a team is picked", () => {
    expect(leagueSectionsProblems(read(false, { myRoster: { open: true } }), "closed", true)).toEqual(["your roster card is open (it should be closed by default, like the others)"]);
    expect(leagueSectionsProblems(read(true, { myRoster: { open: false } }), "open", true)).toEqual(["your roster card didn't open"]);
    expect(leagueSectionsProblems(read(false, { myRoster: null }), "closed", true)).toEqual(["no roster card carries the You badge"]);
  });

  it("fails Best available's Show all in the wrong state or words", () => {
    expect(leagueSectionsProblems(read(true, { showAll: { expanded: false, text: "Show all 30" } }), "open", true)).toEqual(["Best available's “Show all 30” is collapsed"]);
    expect(leagueSectionsProblems(read(false, { showAll: { expanded: false, text: "More" } }), "closed", true)).toEqual(["Best available's button reads “More”"]);
  });

  it("names the cards the League page closes by default", () => {
    expect(LEAGUE_DISCLOSURES).toEqual({ heatmap: "Positional strength", "free-agents": "Best available" });
  });
});

describe("the reader and the tap expressions (Checkpoint 7h)", () => {
  it("compile with the page helpers", () => {
    const body = (code: string) => `return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${code}\n})`;
    expect(() => new Function(body(READ_LEAGUE_SECTIONS))).not.toThrow();
    for (const expr of [MY_ROSTER_SUMMARY, FREE_AGENTS_ALL, leagueDisclosure("heatmap"), leagueDisclosure("free-agents")]) {
      expect(() => new Function(body(`return ${expr};`))).not.toThrow();
      expect(() => new Function(body(`return ${expr}.getAttribute("aria-expanded") === "true";`))).not.toThrow();
    }
    expect(leagueDisclosure("heatmap")).toBe('document.querySelector("main button[data-league-disclosure=\\"heatmap\\"]")');
  });

  it("find what the League page renders: each card's heading button naming its hidden body, Show all, my roster's summary", () => {
    const f = leagueFixture();
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    // A position with more free agents than shown, so "Show all" is there.
    const rows = view.freeAgents.flatMap((g) => g.players);
    const many = { ...view, freeAgents: view.freeAgents.map((g) => ({ ...g, players: Array.from({ length: config.leaguePage.freeAgentsShown + 1 }, (_, i) => ({ ...(rows[i % rows.length] as (typeof rows)[number]), id: `${g.pos}-${i}` })) })) };
    const html = renderToStaticMarkup(createElement(LeagueView, { view: many }));
    for (const [key, heading] of Object.entries(LEAGUE_DISCLOSURES)) {
      const m = new RegExp(`<h2[^>]*><button type="button" aria-expanded="false" aria-controls="([^"]+)" data-league-disclosure="${key}"[^>]*><span[^>]*>${heading}</span><span aria-hidden="true"[^>]*>▾</span></button></h2><div id="\\1" hidden=""`).exec(html);
      expect(m, key).not.toBeNull();
    }
    expect(html).toMatch(/<button type="button" aria-expanded="false" data-free-agents-all=""[^>]*>Show all \d+<span class="sr-only"> free agents<\/span><\/button>/);
    // My roster card: a closed <details> whose summary carries the You badge, around its player table.
    expect(html).toMatch(/<details class="[^"]*"><summary[^>]*><span[^>]*><span[^>]*>Moonbeam Mudcats <span[^>]*>You<\/span>/);
    expect(html).not.toContain("<details open");
  });
});
