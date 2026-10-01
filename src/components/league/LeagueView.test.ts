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
import type { SeasonOdds } from "@/engine/leagueModel";
import { weekUnderWayNote } from "@/engine/season";
import { SEASON_OVER_PARTNERS_TEXT, SEASON_OVER_TEXT, UNDER_WAY_TEXT, buildLeagueView } from "@/lib/leagueView";
import type { RefreshControl } from "../import/ReportView";
import { LeagueView } from "./LeagueView";
import { PlayerDetail } from "./PlayerTable";
import { HEAT_CLASS } from "./StrengthHeatmap";
import { BEFORE_KICKOFF, NOW, leagueFixture, type LeagueFixture } from "./testFixtures";

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

/** RegExp source for a class attribute's value (right after class="): hidden on phones, a table cell from sm up (375 px)… */
const WIDE_ONLY = '(?=(?:[^"]*\\s)?hidden[\\s"])(?=[^"]*sm:table-cell[\\s"])[^"]*';
/** …and one shown at every width (no `hidden`). */
const SHOWN = '(?!(?:[^"]*\\s)?hidden[\\s"])[^"]*';

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

/** The page for an edited fixture. */
function renderFixture(f: LeagueFixture, now = NOW): string {
  const view = buildLeagueView({ ...f, myTeamSource: f.model.myTeamId ? "platform" : "none", timeZone: "America/Chicago", now });
  return renderToStaticMarkup(createElement(LeagueView, { view, refresh }));
}

function oddsOf(f: LeagueFixture): SeasonOdds {
  if (!f.model.odds) throw new Error("fixture odds missing");
  return f.model.odds;
}

/** The standings card's markup (the first "Playoff odds" is its title; the explainer's comes much later). */
const standingsOf = (page: string) => between(page, ">Playoff odds<", "Your remaining games");
const scheduleOf = (page: string) => between(page, ">Your remaining games<", "Projected strength");

describe("LeagueView standings and playoff odds (§8; §17 Checkpoint 3)", () => {
  const standings = standingsOf(html);

  it("comes right after the header and warnings, before my schedule and the team table", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at("Some data is missing")).toBeLessThan(at(">Playoff odds<"));
    expect(at(">Playoff odds<")).toBeLessThan(at(">Your remaining games<"));
    expect(at(">Your remaining games<")).toBeLessThan(at(">Projected strength<"));
  });

  it("is a captioned table in today's standings order, a row header per team, mine badged", () => {
    expect(standings).toContain(
      '<caption class="sr-only">Standings today by your league&#x27;s rules, with each team&#x27;s chance to make the playoffs and win the title, and its projected final record, from 5,000 simulated seasons</caption>',
    );
    const teams = [...standings.matchAll(/<th scope="row"[^>]*><span class="block font-bold wrap-anywhere">([^<]+)</g)].map((m) => m[1]?.trim());
    expect(teams).toEqual(["Gravel Gophers", "Moonbeam Mudcats", "Quasar Quokkas", "Tundra Tortoises"]);
    expect(standings).toMatch(/<tr class="bg-brand-soft"><td[^>]*>2<\/td><th scope="row"[^>]*><span[^>]*>Moonbeam Mudcats <span[^>]*>You<\/span>/);
    expect(textOf(standings)).toContain("1 Gravel Gophers 8–3 projected final record 9.8–4.2 1210.3 93% 47%");
  });

  it("puts the projected final record under today's (said as such to screen readers), and hides points for on phones (375 px)", () => {
    expect(standings).toContain('<span class="block font-semibold">7–4</span><span class="block text-xs text-muted"><span class="sr-only">projected final record </span>8.5–5.5</span>');
    expect(standings).toMatch(/<abbr title="Projected final regular-season record[^"]*" class="[^"]*whitespace-nowrap[^"]*">proj\. final<\/abbr>/);
    expect(standings).toMatch(new RegExp(`<th scope="col" class="${WIDE_ONLY}"><abbr title="Points for, so far">PF</abbr></th>`));
    expect(standings).toMatch(new RegExp(`<td class="${WIDE_ONLY}">1180\\.4</td>`));
    // The record shows at every width.
    expect(standings).toMatch(new RegExp(`<th scope="col" class="${SHOWN}">Record<abbr`));
  });

  it("in a points-only league, shows points for on phones (they decide the standings) and the record only on wider screens", () => {
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, pointsOnly: true } };
    const pointsOnly = standingsOf(renderFixture(f));
    expect(pointsOnly).toMatch(new RegExp(`<th scope="col" class="${SHOWN}"><abbr title="Points for, so far">PF</abbr></th>`));
    expect(pointsOnly.match(new RegExp(`<td class="${SHOWN}">(1210\\.3|1180\\.4|1100|990\\.5)</td>`, "g"))).toHaveLength(4);
    expect(pointsOnly).toMatch(/<td class="[^"]*font-semibold[^"]*">1210\.3<\/td>/);
    expect(pointsOnly).toMatch(new RegExp(`<th scope="col" class="${WIDE_ONLY}">Record</th>`));
    expect(pointsOnly.match(new RegExp(`<td class="${WIDE_ONLY}"><span class="block font-semibold">\\d+–\\d+</span></td>`, "g"))).toHaveLength(4);
    // Ranked by points for, so a phone reads the order off the numbers: 1210.3, 1180.4, 1100, 990.5.
    expect(textOf(pointsOnly)).toContain("1 Gravel Gophers 8–3 1210.3 93% 47% 2 Moonbeam Mudcats You 7–4 1180.4 86% 43%");
  });

  it("has no Playoffs column when fewer than 2 teams make the playoffs, and makes the title odds the headline number", () => {
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), playoffTeams: 0, teams: oddsOf(f).teams.map((t) => ({ ...t, pPlayoffs: 0 })) };
    const none = standingsOf(renderFixture(f));
    expect(none).not.toContain(">Playoffs</abbr>");
    expect(none).toContain('<abbr title="Chance to win the title">Title</abbr>');
    expect(none).toContain("chance to win the title, and its projected final record");
    expect(none).not.toContain("make the playoffs");
    expect(none).toMatch(/<td class="[^"]*font-extrabold[^"]*">47%<\/td>/);
    expect(textOf(none)).toContain("1 Gravel Gophers 8–3 projected final record 9.8–4.2 1210.3 47%");
    // With playoffs, the title odds are plain.
    expect(standings).toMatch(/<td class="py-2\.5 pr-4 text-right align-top tabular-nums sm:pr-0">47%<\/td>/);
  });

  it("says symbolic odds in words: <1% is read as 'less than 1%'", () => {
    expect(standings).toContain('<span aria-hidden="true">&lt;1%</span><span class="sr-only">less than 1%</span>');
    expect(standings).toMatch(/<abbr title="Chance to make the playoffs">Playoffs<\/abbr>/);
    expect(standings).toMatch(/<abbr title="Chance to win the title">Title<\/abbr>/);
  });

  it("adds the Bye column only when the league has first-round byes", () => {
    expect(standings).not.toContain(">Bye</abbr>");
    const f = leagueFixture();
    const byes: Record<string, number> = { "1": 0.18, "2": 0.8, "3": 0.0196, "4": 0.0004 };
    f.model.odds = { ...oddsOf(f), playoffTeams: 3, byes: 1, teams: oddsOf(f).teams.map((t) => ({ ...t, pBye: byes[t.teamId] ?? null })) };
    const withByes = standingsOf(renderFixture(f));
    expect(withByes).toContain('<abbr title="Chance of a first-round playoff bye">Bye</abbr>');
    expect(textOf(withByes)).toContain("2 Moonbeam Mudcats You 7–4 projected final record 8.5–5.5 1180.4 86% 18% 43%");
  });

  it("marks a team out of the title race in words, and says when my season's over, right under the header", () => {
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => (t.teamId === "4" ? { ...t, eliminated: true } : t)) };
    const out = renderFixture(f);
    expect(standingsOf(out)).toMatch(/Tundra Tortoises <span title="Out of the title race"><span[^>]*><span aria-hidden="true">Out<\/span><span class="sr-only">out of the title race<\/span><\/span><\/span>/);
    expect(out).not.toContain(SEASON_OVER_TEXT.replace("'", "&#x27;"));
    const g = leagueFixture();
    g.model.odds = { ...oddsOf(g), teams: oddsOf(g).teams.map((t) => (t.teamId === "1" ? { ...t, eliminated: true } : t)) };
    const over = renderFixture(g);
    const message = "Your season&#x27;s over — no trade helps this year.";
    expect(over).toContain(message);
    expect(over.indexOf(message)).toBeLessThan(over.indexOf("Some data is missing"));
    expect(over.indexOf("</header>")).toBeLessThan(over.indexOf(message));
    // …and the Trade partners card offers none, saying why (no "Pick your team" link: a team is picked).
    const partners = between(over, "Best fits for your team", 'id="rosters-title"');
    expect(textOf(partners)).toContain(SEASON_OVER_PARTNERS_TEXT);
    expect(partners).not.toContain("They could give:");
    expect(partners).not.toContain('href="/import#your-team"');
    expect(between(out, "Best fits for your team", 'id="rosters-title"')).toContain("They could give:");
  });

  it("lists how the odds were made under the table", () => {
    expect(standings).toContain(
      `<ul class="mt-3 space-y-1 text-xs text-muted" aria-label="How the odds were made"><li>Odds from 5,000 simulated seasons.</li><li>Ties in the standings go to points for, the league&#x27;s rule.</li><li>${weekUnderWayNote(12).replace(/'/g, "&#x27;")}</li></ul>`,
    );
  });

  it("says when there are no odds (and shows no schedule then)", () => {
    const f = leagueFixture();
    f.model.odds = null;
    const none = renderFixture(f);
    expect(textOf(none)).toContain("Standings Playoff odds Playoff odds aren't available for this league right now.");
    expect(none).not.toContain("Your remaining games");
  });

  it("lets a long one-word team name wrap anywhere wherever teams are named, so it can't push the odds off a phone (375 px)", () => {
    // overflow-wrap: anywhere (wrap-anywhere) lets a table column shrink below a long word; break-words (overflow-wrap:
    // break-word) doesn't count toward a cell's minimum width, so such a name widened its column and pushed Title off-screen.
    const long = "GridironGladiatorsOfDoom";
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, teams: f.snapshot.teams.map((t) => (t.id === "2" ? { ...t, name: long } : t)) };
    const page = renderFixture(f);
    expect(standingsOf(page)).toContain(`<span class="block font-bold wrap-anywhere">${long}</span>`);
    expect(scheduleOf(page)).toContain(`<span class="block font-bold wrap-anywhere">${long}</span>`);
    const teams = between(page, "Projected strength", "Positional strength");
    expect(teams).toContain(`<span class="block font-bold wrap-anywhere">${long} </span>`);
    // A trade chip names the team it would help.
    expect(teams).toMatch(new RegExp(`<span title="[^"]*" class="inline-block max-w-full rounded-full [^"]*wrap-anywhere[^"]*"><span aria-hidden="true">W\\. Spoons: worth \\+15 to ${long}</span>`));
    // A partner card's heading is a flex item: it needs min-w-0 to shrink below the name, or the card widens the page.
    expect(between(page, "Best fits for your team", 'id="rosters-title"')).toContain(`<h3 class="min-w-0 font-extrabold wrap-anywhere">${long}</h3>`);
    expect(between(page, ">Playoff odds<", 'id="rosters-title"')).not.toMatch(new RegExp(`break-words[^>]*>[^<]*${long}`));
  });
});

describe("LeagueView remaining schedule (§8: each remaining week's risk)", () => {
  const schedule = scheduleOf(html);

  it("is a captioned table with the week as each row's header, and says who counts as a likely starter", () => {
    expect(schedule).toContain(
      '<caption class="sr-only">Your remaining regular-season games: the opponent, projected points for you and them, and your chance to win each week</caption>',
    );
    // Row headers say "Week 12" to screen readers; the column shows just the number.
    expect([...schedule.matchAll(/<th scope="row"[^>]*><span aria-hidden="true">(\d+)<\/span><span class="sr-only">Week \1<\/span><\/th>/g)].map((m) => m[1])).toEqual(["12", "13", "14"]);
    for (const h of ['<abbr title="NFL week">Wk</abbr>', '<abbr title="Your projected points">You</abbr>', '<abbr title="Their projected points">Them</abbr>', '<abbr title="Your chance to win the game">Win</abbr>'])
      expect(schedule).toContain(h);
    expect(textOf(schedule)).toContain("13 Tundra Tortoises 90 85 56%");
    expect(textOf(schedule)).toContain('"On bye" names your likely starters who are off that week');
  });

  it("flags a risky week with a badge and its reasons in words, the whole sentence read once by screen readers", () => {
    expect(schedule).toMatch(
      /<span title="Risky week: your chance to win is under 40%\." class="mt-1 block text-xs"><span aria-hidden="true" class="flex[^"]*"><span class="[^"]*bg-warn-bg text-warn-fg[^"]*">Risky week<\/span><span class="font-semibold text-warn-fg">under 40% to win<\/span><\/span><span class="sr-only">Risky week: your chance to win is under 40%\.<\/span><\/span>/,
    );
    expect(schedule.match(/Risky week</g)).toHaveLength(1);
    expect(schedule).toContain('<span title="Dorian Quibble Jr." class="mt-1 block text-xs break-words text-muted">On bye: D. Quibble</span>');
    expect(schedule).toContain(`<span class="mt-1 block text-xs text-muted italic">${UNDER_WAY_TEXT.replace(/'/g, "&#x27;")}</span>`);
  });

  it("adds a Median column in median-game leagues, and says a bye week has no opponent", () => {
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, medianGame: true } };
    f.model.odds = {
      ...oddsOf(f),
      weekly: oddsOf(f).weekly.map((wk) => ({ ...wk, games: wk.games.map((g) => (wk.week === 13 && g.teamId === "1" ? { ...g, opponentId: null, pWin: null, pMedianWin: 0.62 } : { ...g, pMedianWin: 0.5 })) })),
    };
    const median = scheduleOf(renderFixture(f));
    expect(median).toContain('<abbr title="Your chance of a top-half score that week (the median game)">Median</abbr>');
    expect(textOf(median)).toContain(`12 Quasar Quokkas ${UNDER_WAY_TEXT} 91.4 88 54% 50%`);
    expect(textOf(median)).toContain("13 Bye week 90 — no opponent — no game 62%");
  });

  it("says under the opponent when a multi-week matchup is already under way, so its numbers aren't read as the whole matchup's", () => {
    const f = leagueFixture({ gameDay: false });
    f.snapshot = { ...f.snapshot, schedule: f.snapshot.schedule.map((m) => (m.week === 12 && m.teamA === "1" ? { ...m, week: 11, weeks: [11, 12] } : m)) };
    const spanning = scheduleOf(renderFixture(f, BEFORE_KICKOFF));
    expect(spanning).toMatch(/<th scope="row"[^>]*><span aria-hidden="true">11–12<\/span><span class="sr-only">Weeks 11–12<\/span><\/th>/);
    expect(spanning).toContain('<span class="mt-1 block text-xs text-muted italic">Week 11 already played: its points aren&#x27;t counted, so these numbers cover week 12 only</span>');
  });

  it("asks for a team when none is picked", () => {
    const none = render({ myTeamId: null });
    expect(textOf(scheduleOf(none))).toContain("Pick your team to see your remaining games and each week's risk. Pick your team");
    expect(scheduleOf(none)).toContain('href="/import#your-team"');
  });
});

describe("LeagueView team table", () => {
  it("is a captioned table with a row header per team, mine badged", () => {
    const teams = between(html, "Projected strength", "Positional strength");
    expect(teams).toContain('<caption class="sr-only">Teams ranked by projected points per week, with each team&#x27;s needs and trade chips</caption>');
    expect(teams.match(/<th scope="row" class="py-2\.5[^"]*"/g)).toHaveLength(4);
    expect(teams).toMatch(/<tr class="bg-brand-soft">.*?Moonbeam Mudcats <span[^>]*>You<\/span>/);
  });

  it("says which weeks the ranking counts (the playoff odds have their own table now)", () => {
    expect(text).toContain("Ranked by projected points per week from week 13 on (week 12 is under way). Values: FantasyCalc");
    expect(textOf(render({ gameDay: false }))).toContain("Ranked by projected points per week. Values: FantasyCalc");
    expect(text).not.toContain("Playoff odds arrive");
  });

  it("gives every chip its full meaning for screen readers, trade chips under their own label ('Surplus' is gone)", () => {
    expect(html).toContain('<span class="sr-only">Need at RB1 (rest of season): 11.8 pts/wk vs the league median 14</span>');
    const w = config.lineups.playoffWeight;
    expect(html).toContain(
      `<span aria-hidden="true">C. Snoot: worth +31 to you</span><span class="sr-only">Cornelius Snoot (RB): worth 31.2 more lineup pts (playoffs count ${w}×) to Moonbeam Mudcats (your team) than to his own team. Moonbeam Mudcats (your team) would gain 35.2 with him (after its best free-agent move); his team would lose 4 without him.</span>`,
    );
    expect(html).toMatch(/title="Need at WR \(next 4 weeks\)[^"]*" class="[^"]*border-dashed/);
    expect(text).toContain("Trade chips C. Snoot: worth +31 to you");
    expect(text).toContain("trade chip: worth at least 10 more lineup pts to another team than to his own");
    expect(text).not.toMatch(/surplus/i);
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
  it("shows each side's trade chips, the rest counted (named on hover and for screen readers)", () => {
    expect(text).toContain(
      "Gravel Gophers Fit 2.4 They could give: C. Snoot (+2.1/wk), I. Fumblewick (+1.2/wk), M. Gloop (+0.8/wk) and 1 more and 1 more: P. Plunk (+0.5/wk) You could give: W. Spoons (+1.8/wk)",
    );
    expect(html).toContain(
      '<span title="Percival Plunk: +0.5 points per week to the other lineup" class="text-muted"> <span aria-hidden="true">and 1 more</span><span class="sr-only">and 1 more: P. Plunk (+0.5/wk)</span></span>',
    );
    // A one-sided fit is badged by what was measured, and says plainly what it would cost.
    expect(text).toContain("Tundra Tortoises Would start for you They could give: O. Wren (+1.6/wk) You could give: no trade chip that would start for them, so a trade would likely cost you a starter.");
    expect(text).not.toContain("Fills your needs");
    expect(text).toContain("Points per week are what each trade chip would add to the other team's starting lineup, after that team's best free-agent move.");
    expect(text).toContain("teams with a trade chip who would start for you, when none of yours would start for them, come last.");
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

  it("says which ESPN signal a conflicted player follows (§6 step 3): a line in his button, the sentence on hover and at the top of his breakdown", () => {
    const long = "ESPN: questionable, return week 15 — using Sleeper&#x27;s projection (questionable this week, then healthy)";
    expect(html).toContain(`<span title="${long}" class="block pl-4 text-xs break-words text-muted italic">ESPN says back wk 15; using Sleeper</span><span class="sr-only">, week by week</span></button>`);
    expect(html).toContain('>Out until ~wk 16 (ESPN)</span><span class="sr-only">, week by week</span></button>');
    const f = leagueFixture();
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const q = view.rosters[0]?.players.find((p) => p.id === "103");
    if (!q) throw new Error("fixture RB missing");
    const detail = renderToStaticMarkup(createElement(PlayerDetail, { player: q, showLineupCost: true }));
    expect(detail).toContain(`<p class="mb-2 text-xs leading-relaxed">${long}.</p>`);
    // Players without a conflict get neither.
    const qb = view.rosters[0]?.players.find((p) => p.id === "101");
    if (!qb) throw new Error("fixture QB missing");
    expect(renderToStaticMarkup(createElement(PlayerDetail, { player: qb, showLineupCost: true }))).not.toContain("ESPN:");
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
    expect(text).toContain("Playoff odds We play out the rest of the season 5,000 times.");
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
