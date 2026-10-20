/**
 * The Trade Analyzer's "What if" laid out (Checkpoint 7h; planner reply to Checkpoint 7g, section 4; WhatIfPanel.tsx): the mode
 * switch, the form (44 px rows and buttons, labeled controls, the picker's prompt and groups, a full side's note), and the
 * result (the planner's line, Helps you with "Helps you here counts your odds only.", the odds lines, the roster moves; no chance
 * they accept, Overall, offers, Plan B or feedback buttons; dimmed when stale). Rendered to static markup on the real engine's
 * answer for a hand league (trade.testing.ts handLeague: made-up players, placeholder teams).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { analyzeWhatIf, buildTradeContext } from "@/engine/evaluate";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { handLeague } from "@/engine/trade.testing";
import { DEFAULT_WHAT_IF_FILTER, EMPTY_WHAT_IF, WHAT_IF_MAX, WHAT_IF_ODDS_ONLY, WHAT_IF_OTHER_TEAMS, WHAT_IF_PROMPT, buildWhatIfView, whatIfChoices, type WhatIfDraft } from "@/lib/whatIfView";
import { contextBaseline } from "@/workers/engine.worker";
import { AnalyzerModeSwitch, WhatIfForm, WhatIfResultView } from "./WhatIfPanel";

const { snapshot, inputs } = handLeague();
const noop = () => undefined;

/** Text as read, tags gone. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function form(draft: WhatIfDraft = EMPTY_WHAT_IF, filter = DEFAULT_WHAT_IF_FILTER, busy = false): string {
  return renderToStaticMarkup(
    createElement(WhatIfForm, { choices: whatIfChoices(snapshot, "1", draft, filter), draft, filter, summary: null, busy, onChange: noop, onFilter: noop, onEvaluate: noop }),
  );
}

function result(proposal: { remove: string[]; add: string[] }, stale = false): string {
  const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0 });
  const view = buildWhatIfView({ ...analyzeWhatIf(ctx, proposal, { settings: defaultTradeSettings() }), baseline: contextBaseline(ctx) }, snapshot);
  return renderToStaticMarkup(createElement(WhatIfResultView, { view, stale }));
}

describe("the Analyzer's mode switch", () => {
  it("two 44 px toggle buttons in a named group, the mode pressed", () => {
    const html = renderToStaticMarkup(createElement(AnalyzerModeSwitch, { mode: "whatif", onChange: noop }));
    expect(html).toMatch(/^<div role="group" aria-label="What to evaluate"/);
    const buttons = [...html.matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]*)">([^<]*)<\/button>/g)].map((m) => ({ pressed: m[1], cls: m[2] ?? "", label: m[3] }));
    expect(buttons.map((b) => [b.label, b.pressed])).toEqual([
      ["Trade with a team", "false"],
      ["What if", "true"],
    ]);
    for (const b of buttons) expect(b.cls).toContain("min-h-11");
  });
});

describe("the what-if form", () => {
  it("lays out the two sides, labeled controls and the picker's prompt; Evaluate waits for a player", () => {
    const html = form();
    const text = textOf(html);
    expect(html).toContain("<legend class=\"text-base font-extrabold tracking-tight\">Take off</legend>");
    expect(html).toContain("<legend class=\"text-base font-extrabold tracking-tight\">Put on</legend>");
    for (const label of ["From", "Position", "Name"]) expect(html).toMatch(new RegExp(`<label for="[^"]+" class="text-sm font-bold">${label}</label>`));
    expect(html).toMatch(/<input id="[^"]+" type="search" autoComplete="off" placeholder="Search players" class="[^"]*min-h-11[^"]*text-base[^"]*" value=""\/>/);
    expect(text).toContain(WHAT_IF_PROMPT);
    expect(text).toContain("Nobody yet: pick players below.");
    expect(html).toMatch(/aria-disabled="true"[^>]*>Evaluate change<\/button>/);
    expect(text).toContain("Pick at least one player to take off or put on.");
    // Every row a 44 px target.
    const rows = [...html.matchAll(/<label class="([^"]*)"><input type="checkbox"/g)].map((m) => m[1] ?? "");
    expect(rows.length).toBe(10);
    for (const cls of rows) expect(cls).toContain("min-h-11");
  });

  it("lists a team's players in a named group, the picked ones with a 44 px Remove, a full side saying why", () => {
    const draft: WhatIfDraft = { remove: ["q1"], add: ["fw", "ra2"] };
    const html = form(draft, { ...DEFAULT_WHAT_IF_FILTER, from: "2" });
    expect(html).toMatch(/<div role="group" aria-label="Team 2" class="mt-2">/);
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Remove<span class="sr-only"> Testy McTest fw<\/span><\/button>/);
    expect(textOf(html)).toContain("Testy McTest ra2 RB · AAA · from Team 2");
    expect(html).not.toMatch(/aria-disabled="true"[^>]*>Evaluate change/);
    expect(textOf(html)).toContain("Clear players");
    const full = form({ remove: ["q1", "ra1", "rb1", "wa1", "wb1"].slice(0, WHAT_IF_MAX), add: [] });
    expect(textOf(full)).toContain(`That's ${WHAT_IF_MAX} players, the most you can take off here. Uncheck one to pick another.`);
    expect(form(EMPTY_WHAT_IF, DEFAULT_WHAT_IF_FILTER, true)).toMatch(/>Evaluating…<\/button>/);
  });
});

describe("the what-if's result", () => {
  it("the planner's line, Helps you on my odds alone, the odds lines and the roster moves; nothing of a trade's offer", () => {
    const html = result({ remove: ["q1"], add: [] });
    const text = textOf(html);
    expect(html).toMatch(/<h2 id="whatif-title"[^>]*>The change, evaluated<\/h2>/);
    expect(text).toContain(WHAT_IF_OTHER_TEAMS);
    expect(text).toContain("Your roster with this change");
    expect(text).toContain(WHAT_IF_ODDS_ONLY);
    expect(html).toMatch(/<dt class="[^"]*">Helps you<\/dt>/);
    expect(text).toMatch(/Title odds \d+\.\d% → \d+\.\d%/);
    expect(text).toMatch(/Playoff odds/);
    expect(html).toContain('data-roster-moves="whatif"');
    expect(text).toContain("Open roster spot: add Testy McTest fq, the best available QB.");
    for (const word of ["Chance they accept", "Overall", "How to offer it", "Message to send them", "If they won't move", "Sent", "Accepted", "Report a problem"]) expect(text).not.toContain(word);
  });

  it("stale: says so, and dims the numbers", () => {
    const html = result({ remove: ["q1"], add: [] }, true);
    expect(textOf(html)).toContain("You've changed the players, your settings or the league data since. Evaluate it again to see the new numbers.");
    expect(html).toContain('class="space-y-4 transition-opacity opacity-60"');
  });

  it("a change that can't be made: why, in a callout, and no card", () => {
    const text = textOf(result({ remove: ["ra2"], add: [] }));
    expect(text).toContain("This change can't be made Testy McTest ra2 isn't on your active roster or IR.");
    expect(text).not.toContain("Your roster with this change");
  });
});
