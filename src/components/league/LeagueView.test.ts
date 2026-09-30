/**
 * The League page's markup, rendered statically (no DOM, first render only), from the fictional
 * league in testFixtures.ts: accessible names and wiring (row headers, row groups, a named scroll
 * region, a Refresh that keeps focus), the FantasyCalc credit next to every set of values (CLAUDE.md
 * §2.9), game days (a week in progress), and the 375 px layout rules (wide-only columns hidden on
 * phones, 44 px targets).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { buildLeagueView } from "@/lib/leagueView";
import type { RefreshControl } from "../import/ReportView";
import { LeagueView } from "./LeagueView";
import { PlayerDetail } from "./PlayerTable";
import { HEAT_CLASS } from "./StrengthHeatmap";
import { BEFORE_KICKOFF, NOW, leagueFixture } from "./testFixtures";

const noop = () => {};
const refresh: RefreshControl = { onRefresh: noop, refreshing: false, error: null, status: null };

function render(opts: Parameters<typeof leagueFixture>[0] = {}, control: RefreshControl | undefined = refresh): string {
  const f = leagueFixture(opts);
  const view = buildLeagueView({ ...f, myTeamSource: f.model.myTeamId ? "platform" : "none", timeZone: "America/Chicago", now: opts.gameDay === false ? BEFORE_KICKOFF : NOW });
  return renderToStaticMarkup(createElement(LeagueView, { view, refresh: control }));
}

/** Visible text, tags and entities removed. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ,/g, ",");
}

/** The markup from `start` up to (not including) `end`. */
function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = html.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to);
}

const CREDIT = /<a href="https:\/\/fantasycalc\.com" target="_blank" rel="noopener noreferrer"[^>]*>Values: FantasyCalc<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/g;

const html = render();
const text = textOf(html);

describe("LeagueView header", () => {
  it("names the league, the week (dated in full) and the sources, with the FantasyCalc credit", () => {
    expect(html).toMatch(/<h1[^>]*>The Gloopdorf Invitational<\/h1>/);
    expect(text).toContain("Week 12 · as of Thu, Nov 26, 3:55 PM");
    expect(text).toContain("Projected points: Sleeper · Values: FantasyCalc (opens in a new tab) (8 teams · half-PPR · 1 QB · redraft)");
    expect(text).toContain("6 weeks left: 3 regular season, 3 playoffs");
  });

  it("says when the current week is under way and team numbers skip it, and not before its first kickoff", () => {
    expect(html).toMatch(/<p class="mt-1 text-sm text-navy-contrast\/80">Week 12 is under way, so team numbers start with week 13\.<\/p>/);
    expect(render({ gameDay: false })).not.toContain("under way, so team numbers");
  });

  it("keeps Refresh's status line mounted, and shows a Refresh error as an alert", () => {
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Refresh<\/button>/);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    const failed = render({}, { ...refresh, error: "ESPN isn't responding right now." });
    expect(failed).toMatch(/role="alert"[^>]*>ESPN isn&#x27;t responding right now\.</);
  });

  it("keeps a busy Refresh focusable: aria-disabled, never the disabled attribute that drops focus to the page", () => {
    const busy = render({}, { ...refresh, refreshing: true });
    expect(busy).toMatch(/<button type="button" aria-disabled="true" class="[^"]*aria-disabled:opacity-60[^"]*">Refreshing…<\/button>/);
    expect(busy).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("links 'Values: FantasyCalc' next to every set of values, opening in a new tab (§2.9)", () => {
    expect(html.match(CREDIT)).toHaveLength(4); // header, team table, rosters, free agents
    const sections = {
      header: between(html, "<header", "</header>"),
      teams: between(html, "Projected strength", "Positional strength"),
      rosters: between(html, 'id="rosters-title"', "Best available"),
      freeAgents: between(html, "Best available", "How these numbers work"),
    };
    for (const [name, markup] of Object.entries(sections)) expect(markup.match(CREDIT) ?? [], name).toHaveLength(1);
    // Both tables with a Value column sit in a section with its credit.
    expect(sections.rosters).toContain(">Value</th>");
    expect(sections.freeAgents).toContain(">Value</th>");
  });

  it("lists the data gaps", () => {
    expect(text).toContain("Some data is missing Sleeper's week 17 projections didn't load. No projection for Dabney Drifter.");
  });
});

describe("LeagueView team table", () => {
  it("is a captioned table with a row header per team, mine badged", () => {
    expect(html).toContain('<caption class="sr-only">Teams ranked by projected points per week, with each team&#x27;s needs and surplus players</caption>');
    expect(html.match(/<th scope="row" class="py-2\.5[^"]*"/g)).toHaveLength(4);
    expect(html).toMatch(/<tr class="bg-brand-soft">.*?Moonbeam Mudcats <span[^>]*>You<\/span>/);
  });

  it("says which weeks the ranking counts", () => {
    expect(text).toContain("Ranked by projected points per week from week 13 on (week 12 is under way). Playoff odds arrive in the next update.");
    expect(textOf(render({ gameDay: false }))).toContain("Ranked by projected points per week. Playoff odds arrive in the next update.");
  });

  it("gives every chip its full meaning for screen readers", () => {
    expect(html).toContain('<span class="sr-only">Need at RB1 (rest of season): 11.8 pts/wk vs the league median 14</span>');
    expect(html).toContain('<span class="sr-only">Cornelius Snoot (RB): would start for 1 other team</span>');
    expect(html).toMatch(/title="Need at WR \(next 4 weeks\)[^"]*" class="[^"]*border-dashed/);
  });

  it("hides the wide-only columns on phones (375 px)", () => {
    expect(html).toMatch(/<th scope="col" class="hidden [^"]*sm:table-cell"><abbr title="Points for, so far">PF<\/abbr><\/th>/);
    expect(html).toMatch(/<th scope="col" class="hidden [^"]*sm:table-cell"><abbr title="[^"]*">ROS pts<\/abbr><\/th>/);
  });
});

describe("LeagueView heatmap", () => {
  it("is a captioned table with a pinned team column and a two-button window toggle", () => {
    expect(html).toContain("Points per week from each team&#x27;s starter in each lineup slot, rest of season (weeks 13–17).");
    expect(html).toMatch(/<div role="group" aria-label="Time window"/);
    expect(html).toMatch(/<button type="button" aria-pressed="true" class="min-h-11[^"]*">Rest of season<\/button>/);
    expect(html).toMatch(/<button type="button" aria-pressed="false" class="min-h-11[^"]*">Next 4 weeks<\/button>/);
    expect(html).toMatch(/<th scope="row" title="Moonbeam Mudcats" class="sticky left-0[^"]*">Moonbeam Mudcats<span[^>]*> \(you\)<\/span><\/th>/);
  });

  it("scrolls sideways in a named region the keyboard can reach (it takes focus, with the focus ring)", () => {
    expect(html).toMatch(/<div role="region" aria-label="Positional strength table \(scrolls sideways on small screens\)" tabindex="0" class="relative -mx-4 overflow-x-auto sm:mx-0"><table/);
    // Exactly one keyboard stop added to the page, and it's the scroller.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("prints each cell's points and spells out its step, so color never carries it alone", () => {
    expect(html).toMatch(/<td title="Moonbeam Mudcats · RB1: 11\.8 pts\/wk, weak[^"]*" class="[^"]*bg-heat-weak text-heat-weak-ink[^"]*">11\.8<span class="sr-only">, weak<\/span><\/td>/);
    expect(html).toMatch(/<td title="Moonbeam Mudcats · QB: 21\.5[^"]*" class="[^"]*bg-heat-strong text-heat-strong-ink[^"]*">21\.5<span class="sr-only">, strong<\/span><\/td>/);
    expect(text).toContain("Strong Above average Average Below average (a need) Weak (a need)");
  });

  it("colors cells and the key with the theme's heat tokens (light and dark in globals.css), never raw hex", () => {
    for (const step of ["strong", "above", "average", "below", "weak"]) {
      expect(HEAT_CLASS[step as keyof typeof HEAT_CLASS]).toBe(`bg-heat-${step} text-heat-${step}-ink`);
      expect(html).toMatch(new RegExp(`<span aria-hidden="true" class="inline-block size-3\\.5 rounded-sm bg-heat-${step} text-heat-${step}-ink"></span>`));
    }
    expect(html).not.toMatch(/(bg|text)-\[#/);
  });
});

describe("LeagueView trade partners", () => {
  it("shows what each side could give", () => {
    expect(text).toContain("Gravel Gophers Fit 2.4 They could give: C. Snoot (+2.1/wk), I. Fumblewick (+1.2/wk) You could give: W. Spoons (+1.8/wk)");
    // A one-sided fit is badged by what was measured, and says plainly what it would cost.
    expect(text).toContain("Tundra Tortoises Would start for you They could give: O. Wren (+1.6/wk) You could give: no spare player they need, so a trade would likely cost you a starter.");
    expect(text).not.toContain("Fills your needs");
    expect(text).toContain("teams with a spare player who would start for you, but who need nothing you can spare, come last.");
  });
});

describe("LeagueView rosters", () => {
  it("opens my roster, and collapses the others", () => {
    expect(html.match(/<details open=""/g)).toHaveLength(1);
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*><span[^>]*><span[^>]*>Moonbeam Mudcats <span[^>]*>You<\/span><\/span><span[^>]*>87 pts\/wk · 438 ROS pts<\/span>/);
    expect(html.match(/<details/g)).toHaveLength(5); // 4 rosters + how these numbers work
  });

  it("heads each roster with the team's best free-agent move in lineup points, highlighted for mine, in its header so it shows while collapsed", () => {
    const summaries = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary>/g)].map((m) => m[1] ?? "");
    const mine = summaries.find((s) => s.includes("Moonbeam Mudcats")) ?? "";
    const w = config.lineups.playoffWeight;
    expect(mine).toMatch(
      new RegExp(
        `<span class="mt-2 block rounded-lg bg-brand-soft [^"]*break-words[^"]*"><span class="font-bold">Best free-agent move:</span> add Floopy Freeman \\(RB, CAR\\), drop Tobias Thimble: <span class="whitespace-nowrap tabular-nums font-extrabold">\\+4\\.6 lineup pts</span> \\(playoffs count ${w}×\\)</span>`,
      ),
    );
    const theirs = summaries.find((s) => s.includes("Quasar Quokkas")) ?? "";
    expect(theirs).toMatch(/<span class="mt-1 block text-xs break-words text-muted"><span class="font-bold">Best free-agent move:<\/span> add Waverly Waiver \(RB, NE\) into an open spot: <span[^>]*>\+2\.4 lineup pts<\/span>/);
    // No move that helps: no line. And a weighted gain is never labeled like the plain ROS points beside it.
    const moves = summaries.filter((s) => s.includes("Best free-agent move")).map((s) => s.slice(s.indexOf("Best free-agent move")));
    expect(moves).toHaveLength(2);
    for (const move of moves) expect(move).not.toContain("ROS pts");
    expect(text).toContain("Lineup cost is how many his team would lose without him");
    expect(html).toContain(`<abbr title="Rest-of-season lineup points his team would lose without him, with playoff weeks counted ${w}×">Lineup cost</abbr>`);
  });

  it("makes each player's name cell the row header, so moving down a column says whose number it is", () => {
    const rows = [...html.matchAll(/<tr class="border-b border-line"><(t[hd])[^>]*>/g)];
    // Every player row in every roster and free-agent table: 9 + 7 + 7 + 6 rostered, 3 free agents.
    expect(rows).toHaveLength(32);
    expect(rows.every((m) => m[1] === "th" && m[0].includes('scope="row"'))).toBe(true);
  });

  it("gives each player a disclosure button (44 px, the whole name cell) for his week-by-week points, his position line inside it", () => {
    const button =
      /<th scope="row" class="p-0 [^"]*"><button type="button" aria-expanded="false" aria-controls="(weeks-[^"]+)" class="flex min-h-11 w-full flex-col[^"]*"><span class="flex items-center gap-1\.5"><span aria-hidden="true"[^>]*>▸<\/span><span class="font-bold break-words">Fizzwick Pemberton<\/span><\/span><span class="block pl-4 text-xs text-muted">QB · MIN · bye done<\/span><span class="sr-only">, week by week<\/span><\/button><\/th>/.exec(
        html,
      );
    expect(button).not.toBeNull();
    // Nothing sits over the button's lower edge any more (the old negative margin cut it to 36 px).
    expect(html).not.toContain("-mt-2");
    // Collapsed: the controlled row is there, its breakdown is built only when opened.
    expect(html).toMatch(new RegExp(`<tr id="${button?.[1]}" hidden="" class="border-b border-line"><td colSpan="6"[^>]*></td></tr>`, "i"));
    // Every disclosure controls its own breakdown.
    const ids = [...html.matchAll(/aria-controls="(weeks-[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("heads the IR and taxi groups with row-group headers over their own rows, and names the group in each of those players' buttons", () => {
    expect(html).not.toContain('scope="colgroup"');
    // The heading and its players share one row group (tbody).
    const irGroups = [...html.matchAll(/<tbody><tr><th scope="rowgroup" colSpan="6"[^>]*>Injured reserve<\/th><\/tr>([\s\S]*?)<\/tbody>/g)].map((m) => m[1] ?? "");
    expect(irGroups).toHaveLength(2);
    expect(irGroups[0]).toContain("Humbert Fiddlesticks");
    // A Doubtful player in an IR slot: his badge says Doubtful, so the group name is what says IR.
    expect(irGroups[1]).toMatch(/<span class="font-bold break-words">Rupert Wimbleton<\/span><\/span><span class="sr-only">, injured reserve<\/span><span class="block pl-4 text-xs text-muted">RB · PIT · bye done<span[^>]*><span aria-hidden="true">D<\/span><span class="sr-only">Doubtful<\/span><\/span><\/span>/);
    expect(html).toMatch(/<tbody><tr><th scope="rowgroup" colSpan="6"[^>]*>Taxi squad<\/th><\/tr><tr[^>]*><th scope="row"[^>]*><button[^>]*>.*?Ferdinand Puddle<\/span><\/span><span class="sr-only">, taxi squad<\/span>/);
    // Active players' buttons say no group.
    expect(between(html, "Fizzwick Pemberton", "</button>")).not.toMatch(/injured reserve|taxi squad/);
  });

  it("opens into the columns phones hide and a captioned week-by-week table, a game under way shown like a bye", () => {
    const f = leagueFixture();
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const qb = view.rosters[0]?.players.find((p) => p.id === "101");
    if (!qb) throw new Error("fixture QB missing");
    const detail = renderToStaticMarkup(createElement(PlayerDetail, { player: qb, showLineupCost: true }));
    expect(textOf(detail)).toContain("Games left 5 games Value 7,342 Lineup cost 58.2");
    expect(detail).toContain('<caption class="sr-only">Fizzwick Pemberton: projected points week by week</caption>');
    expect(detail).toMatch(/<th scope="row"[^>]*>15<span[^>]*>playoffs<\/span><\/th><td[^>]*>22<\/td><td[^>]*>100%<\/td>/);
    // Not "0 pts, 0%" under "Chance he plays": his game has kicked off.
    expect(detail).toMatch(/<th scope="row"[^>]*>12<\/th><td[^>]*>—<\/td><td[^>]*>—<\/td><td[^>]*>Game already started<\/td>/);
    expect(renderToStaticMarkup(createElement(PlayerDetail, { player: qb, showLineupCost: false }))).not.toContain("Lineup cost");
  });

  it("shows ROS points with the regular / playoffs split, and hovering lists the weeks", () => {
    expect(html).toMatch(/<td class="[^"]*" title="Wk 12: game already started\nWk 13: 22 pts, 100%[^"]*"><span class="block font-extrabold">110<\/span><span class="block text-xs text-muted">44 \/ 66<\/span><\/td>/);
  });

  it("badges injuries with words for screen readers", () => {
    expect(html).toContain('<span aria-hidden="true">Q</span><span class="sr-only">Questionable</span>');
    expect(html).toContain('<span aria-hidden="true">P</span><span class="sr-only">Probable</span>');
  });

  it("says what ~ means for screen readers: our estimate, or our flat minimum value", () => {
    expect(html).toContain('~180<span class="sr-only"> (our estimate)</span>');
    expect(html).toContain('~107<span class="sr-only"> (our minimum value)</span>');
  });
});

describe("LeagueView free agents and the explainer", () => {
  it("lists the best free agents by position, without a lineup cost", () => {
    expect(text).toContain("Free agents Best available The best at each position by rest-of-season points. Values: FantasyCalc");
    expect(html).toContain('<caption class="sr-only">Best free agents at RB by rest-of-season points</caption>');
    expect(between(html, "Best available", "How these numbers work")).not.toContain("Lineup cost");
  });

  it("explains the numbers and where they came from", () => {
    expect(html).toMatch(/<summary[^>]*>How these numbers work<span/);
    expect(text).toContain("Where the numbers came from");
    expect(text).toContain("FantasyCalc values Wed, Nov 25, 5:00 PM (a saved copy: the live fetch failed)");
    expect(text).toContain("Week 12 is under way Once a week's first game kicks off");
  });

  it("says the values' format and its substitutions once: the server's notes repeating them aren't listed", () => {
    expect(text.match(/4 teams → FantasyCalc's 8-team values/g)).toHaveLength(1);
    expect(text).not.toContain("Trade values: FantasyCalc");
    expect(html).toMatch(/<li class="rounded-xl bg-surface-muted px-3 py-2 text-sm">Sleeper hasn&#x27;t published week 18 projections yet\.<\/li>/);
  });
});

describe("LeagueView without a team", () => {
  const none = render({ myTeamId: null });

  it("asks the user to pick a team on the Import Report", () => {
    expect(textOf(none)).toContain("Which team is yours? Pick your team on the Import Report to see your needs and trade partners. Pick your team");
    expect(none).toContain('href="/import#your-team"');
    expect(none).not.toContain("<details open");
    expect(textOf(none)).toContain("Pick your team to see which teams fit you best as trade partners.");
  });
});
