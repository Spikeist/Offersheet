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
import { fantasyCalcFallbackText } from "@/engine/market";
import { waiverOrderText } from "@/lib/importReport";
import { SEASON_OVER_PARTNERS_TEXT, SEASON_OVER_TEXT, UNDER_WAY_TEXT, buildLeagueView, pickupsUnderWayNote, playoffWeightLabel } from "@/lib/leagueView";
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

const CREDIT = /<a href="https:\/\/fantasycalc\.com" target="_blank" rel="noopener" referrerPolicy="origin"[^>]*>Values: FantasyCalc<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/g;

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

  it("links 'Values: FantasyCalc' in every section its values feed, opening in a new tab (§2.9), though no value shows (planner reply to Checkpoint 7a, 5.4)", () => {
    expect(html.match(CREDIT)).toHaveLength(4); // header, team table, rosters, free agents
    const sections = {
      header: between(html, "<header", "</header>"),
      teams: between(html, "Projected strength", "Positional strength"),
      rosters: between(html, 'id="rosters-title"', "Best available"),
      freeAgents: between(html, "Best available", "How these numbers work"),
    };
    for (const [name, markup] of Object.entries(sections)) expect(markup.match(CREDIT) ?? [], name).toHaveLength(1);
    // Neither table has a Value column any more.
    expect(sections.rosters).not.toContain(">Value</th>");
    expect(sections.freeAgents).not.toContain(">Value</th>");
  });

  it("dates a saved FantasyCalc list next to the values credit, and puts a banner under the header when every value is our estimate (planner reply to Checkpoint 4b, change 12)", () => {
    const withFallback = (fallback: { kind: "saved" | "curve"; listDate: string }) => {
      const f = leagueFixture();
      const market = { values: {}, knownIds: [], topValue: 10722, fetchedAt: fallback.listDate, format: f.model.market.format as NonNullable<LeagueFixture["model"]["market"]["format"]>, fallback };
      f.inputs = { ...f.inputs, market };
      if (fallback.kind === "curve") f.inputs = { ...f.inputs, warnings: [...f.inputs.warnings, { code: "FANTASYCALC_VALUES_ESTIMATED", message: fantasyCalcFallbackText(fallback) }] };
      return renderFixture(f);
    };
    const saved = withFallback({ kind: "saved", listDate: "2026-11-22T09:00:00.000Z" });
    const header = between(saved, "<header", "</header>");
    expect(header).toContain('(8 teams · half-PPR · 1 QB · redraft)<span class="block font-semibold text-navy-contrast">Trade values from Nov 22: FantasyCalc didn&#x27;t answer.</span></p>');
    expect(saved).not.toContain("FantasyCalc is unavailable");
    const curve = withFallback({ kind: "curve", listDate: "2026-11-02T09:00:00.000Z" });
    expect(between(curve, "<header", "</header>")).toContain('<span class="block font-semibold text-navy-contrast">Trade values are our own estimates for now.</span>');
    // The banner, right under the header (before the warnings), in words: its title and the fallback's text, once.
    expect(curve).toMatch(/<\/header><div class="[^"]*"><p class="font-bold">FantasyCalc is unavailable<\/p><div class="mt-1"><p>Trade values are our own estimates, not FantasyCalc&#x27;s: FantasyCalc didn&#x27;t answer, and the newest list we have, from Nov 2/);
    expect(curve.match(/Trade values are our own estimates, not FantasyCalc/g)).toHaveLength(1);
    expect(curve.indexOf("FantasyCalc is unavailable")).toBeLessThan(curve.indexOf("Things to know"));
    expect(html).not.toContain("FantasyCalc is unavailable");
  });

  it("lists the data notices, in plain words (planner reply to Checkpoint 7a, §5.1: the banner shows notices only)", () => {
    expect(text).toContain("Things to know Sleeper's projections for week 17 didn't load, so that week skips the matchup adjustment. Refresh later to try again. No projection for Dabney Drifter.");
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
    expect(at("Things to know")).toBeLessThan(at(">Playoff odds<"));
    expect(at(">Playoff odds<")).toBeLessThan(at(">Your remaining games<"));
    expect(at(">Your remaining games<")).toBeLessThan(at(">Projected strength<"));
  });

  it("leads with my odds (every team after its pickups) and, smaller, the same as rosters stand, then says what the odds count, above the table (planner reply to Checkpoint 4b, change 9)", () => {
    expect(standings).toContain(
      '<div class="mb-2"><p class="text-base font-extrabold tabular-nums">Your odds: <span class="whitespace-nowrap">86% playoffs</span>\u00a0· <span class="whitespace-nowrap">43.0% title</span></p><p class="text-sm text-muted tabular-nums">As rosters stand: <span class="whitespace-nowrap">82% playoffs</span>\u00a0· <span class="whitespace-nowrap">40.0% title</span></p></div>',
    );
    // Checkpoint 7h (planner reply to Checkpoint 7g, §1): one line above the table, the rest behind a 44 px "Why?".
    expect(standings).toContain('<p class="min-w-0 flex-1 leading-relaxed">These odds count each team&#x27;s likely free-agent pickups.</p>');
    expect(standings).toMatch(/<button type="button" aria-expanded="false" aria-controls="([^"]+)" class="[^"]*min-h-11[^"]*">Why\?<span class="sr-only"> \(what the odds count\)<\/span><\/button><\/div><div id="\1" hidden="" class="[^"]*">/);
    expect(standings).toContain("<p>These odds count the free-agent pickups that would help each team (listed on its roster): trade ideas start from the same odds. “As rosters stand” counts no pickups.</p>");
    expect(standings.indexOf("Your odds:")).toBeLessThan(standings.indexOf("<table"));
    // Symbolic odds are read out in words, as in the table.
    const four = standingsOf(render({ myTeamId: "4" }));
    expect(four).toContain(
      'Your odds: <span class="whitespace-nowrap"><span aria-hidden="true">&lt;1% playoffs</span><span class="sr-only">less than 1% playoffs</span></span>\u00a0· <span class="whitespace-nowrap"><span aria-hidden="true">&lt;0.1% title</span><span class="sr-only">less than 0.1% title</span></span>',
    );
    // Each part kept on one line, so the lines wrap between parts at 375 px, never inside "99% top 3" or "40.0% title" (final
    // review of Checkpoint 7c, ui-UI-7C-2: the top-3 part made them wrap there from 320 to 390 px).
    const prizes = leagueFixture();
    prizes.model.reward = { goal: "prizes", shares: { first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 }, periods: 14, empty: false };
    const top3 = standingsOf(renderFixture(prizes));
    expect(top3).toContain('Your odds: <span class="whitespace-nowrap">86% playoffs</span>\u00a0· <span class="whitespace-nowrap">99% top 3</span>\u00a0· <span class="whitespace-nowrap">43.0% title</span></p>');
    expect(top3).toContain('As rosters stand: <span class="whitespace-nowrap">82% playoffs</span>\u00a0· <span class="whitespace-nowrap">98% top 3</span>\u00a0· <span class="whitespace-nowrap">40.0% title</span></p>');
    // No team: no headline, but what the odds count.
    const none = standingsOf(render({ myTeamId: null }));
    expect(none).not.toContain("Your odds:");
    expect(none).toContain("These odds count the free-agent pickups that would help each team");
    expect(none).not.toContain("counts no pickups");
  });

  it("is a captioned table in today's standings order, a row header per team, mine badged", () => {
    expect(standings).toContain(
      '<caption class="sr-only">Standings today by your league&#x27;s rules, with each team&#x27;s chance to make the playoffs and win the title, and its projected final record, from 20,000 simulated seasons, counting each team&#x27;s free-agent pickups that would help</caption>',
    );
    const teams = [...standings.matchAll(/<th scope="row"[^>]*><span class="block font-bold wrap-anywhere">([^<]+)</g)].map((m) => m[1]?.trim());
    expect(teams).toEqual(["Gravel Gophers", "Moonbeam Mudcats", "Quasar Quokkas", "Tundra Tortoises"]);
    expect(standings).toMatch(/<tr class="bg-brand-soft"><td[^>]*>2<\/td><th scope="row"[^>]*><span[^>]*>Moonbeam Mudcats <span[^>]*>You<\/span>/);
    // Title odds with one decimal, as the headline above prints mine (review of track UIP: "43.0% title" over "43%").
    expect(textOf(standings)).toContain("1 Gravel Gophers 8–3 projected final record 9.8–4.2 1210.3 93% 47.0% 2 Moonbeam Mudcats You 7–4 projected final record 8.5–5.5 1180.4 86% 43.0%");
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
    expect(textOf(pointsOnly)).toContain("1 Gravel Gophers 8–3 1210.3 93% 47.0% 2 Moonbeam Mudcats You 7–4 1180.4 86% 43.0%");
  });

  it("has no Playoffs column when fewer than 2 teams make the playoffs, and makes the title odds the headline number", () => {
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), playoffTeams: 0, teams: oddsOf(f).teams.map((t) => ({ ...t, pPlayoffs: 0 })) };
    const none = standingsOf(renderFixture(f));
    expect(none).not.toContain(">Playoffs</abbr>");
    expect(none).toContain('<abbr title="Chance to win the title">Title</abbr>');
    expect(none).toContain("chance to win the title, and its projected final record");
    expect(none).not.toContain("make the playoffs");
    expect(none).toMatch(/<td class="[^"]*font-extrabold[^"]*">47\.0%<\/td>/);
    expect(textOf(none)).toContain("1 Gravel Gophers 8–3 projected final record 9.8–4.2 1210.3 47.0%");
    // With playoffs, the title odds are plain.
    expect(standings).toMatch(/<td class="py-2\.5 pr-4 text-right align-top tabular-nums sm:pr-0">47\.0%<\/td>/);
  });

  it("says symbolic odds in words: <1% is read as 'less than 1%', a title's <0.1% as 'less than 0.1%'", () => {
    expect(standings).toContain('<span aria-hidden="true">&lt;1%</span><span class="sr-only">less than 1%</span>');
    expect(standings).toMatch(/<td class="py-2\.5 pr-4 text-right align-top tabular-nums sm:pr-0"><span aria-hidden="true">&lt;0\.1%<\/span><span class="sr-only">less than 0\.1%<\/span><\/td>/);
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
    expect(textOf(withByes)).toContain("2 Moonbeam Mudcats You 7–4 projected final record 8.5–5.5 1180.4 86% 18% 43.0%");
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
    expect(over.indexOf(message)).toBeLessThan(over.indexOf("Things to know"));
    expect(over.indexOf("</header>")).toBeLessThan(over.indexOf(message));
    // …and the Trade partners card offers none, saying why (no "Pick your team" link: a team is picked).
    const partners = between(over, "Best fits for your team", 'id="rosters-title"');
    expect(textOf(partners)).toContain(SEASON_OVER_PARTNERS_TEXT);
    expect(partners).not.toContain("Best target:");
    expect(partners).not.toContain("could give:");
    expect(partners).not.toContain('href="/import#your-team"');
    expect(between(out, "Best fits for your team", 'id="rosters-title"')).toContain("They could also give:");
  });

  it("lists how the odds were made behind “Why?” (above the table since Checkpoint 7h), with when they count pickups from while a week is under way", () => {
    expect(standings).toContain(
      `<ul class="space-y-1" aria-label="How the odds were made"><li>Odds from 20,000 simulated seasons.</li><li>Ties in the standings go to points for, the league&#x27;s rule.</li><li>${weekUnderWayNote(12).replace(/'/g, "&#x27;")}</li><li>${pickupsUnderWayNote(12, 13).replace(/'/g, "&#x27;")}</li></ul>`,
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
    // Team 3 streams D/ST: the streaming card names it.
    const long3 = "QuasarQuokkasOfTheOuterRim";
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, teams: f.snapshot.teams.map((t) => (t.id === "2" ? { ...t, name: long } : t.id === "3" ? { ...t, name: long3 } : t)) };
    const page = renderFixture(f);
    expect(standingsOf(page)).toContain(`<span class="block font-bold wrap-anywhere">${long}</span>`);
    expect(scheduleOf(page)).toContain(`<span class="block font-bold wrap-anywhere">${long}</span>`);
    const teams = between(page, "Projected strength", "Positional strength");
    expect(teams).toContain(`<span class="block font-bold wrap-anywhere">${long} </span>`);
    // A trade chip names the team it would help.
    expect(teams).toMatch(new RegExp(`<span title="[^"]*" class="inline-block max-w-full rounded-full [^"]*wrap-anywhere[^"]*"><span aria-hidden="true">W\\. Spoons: worth \\+15 to ${long} · costs you 0\\.3 pts/wk</span>`));
    // A partner card's heading is a flex item: it needs min-w-0 to shrink below the name, or the card widens the page.
    expect(between(page, "Best fits for your team", 'id="rosters-title"')).toContain(`<h3 class="min-w-0 font-extrabold wrap-anywhere">${long}</h3>`);
    expect(between(page, ">Playoff odds<", 'id="rosters-title"')).not.toMatch(new RegExp(`break-words[^>]*>[^<]*${long}`));
    // The streaming card's list of teams that stream is a paragraph that wraps anywhere too.
    expect(between(page, "Streaming picks this week", 'id="rosters-title"')).toMatch(new RegExp(`<p class="[^"]*wrap-anywhere[^"]*">Other teams that stream [^<]*${long3} \\(D/ST, 3 adds\\)\\.</p>`));
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
    // Projected points with each team's pickups, as the odds beside them (TeamModel.scoreWithPickups).
    expect(textOf(schedule)).toContain("13 Tundra Tortoises 91.5 85 56%");
    // Game day: week 12 is played with today's rosters, the pickups count from week 13 (what the model does).
    expect(textOf(schedule)).toContain("Projected points and chances count each team's free-agent pickups that would help from week 13 on, as the odds above do: week 12 is played with today's rosters.");
    expect(textOf(schedule)).toContain('"On bye" names your likely starters who are off that week: players in your best lineup, after your free-agent pickups, in at least half the weeks they play');
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
    expect(textOf(median)).toContain("13 Bye week 91.5 — no opponent — no game 62%");
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
  it("is closed by default, its heading the 44 px control that opens it, the table in the page while closed (Checkpoint 7h)", () => {
    const card = between(html, ">Teams<", "Lineup slots");
    const control = /<h2 class="[^"]*"><button type="button" aria-expanded="false" aria-controls="([^"]+)" data-league-disclosure="teams" class="([^"]*)"><span class="[^"]*">Projected strength<\/span><span aria-hidden="true" class="[^"]*">▾<\/span><\/button><\/h2><div id="\1" hidden="" class="mt-3">/.exec(card);
    expect(control).not.toBeNull();
    expect(control?.[2]).toMatch(/(^|\s)min-h-11(\s|$)/);
    expect(control?.[2]).toMatch(/(^|\s)w-full(\s|$)/);
    expect(card).toContain("<caption class=\"sr-only\">Teams ranked by projected points per week");
  });

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
    // The weight as the page prints it, one decimal: config's fallback 1.25 reads 1.3 (planner reply to Checkpoint 7a, §6.1).
    const w = playoffWeightLabel(config.lineups.playoffWeight);
    // A bench chip: his gap and what he costs his team a week (Checkpoint 3 answer 3), the title saying both in full.
    expect(html).toContain(
      `<span aria-hidden="true">C. Snoot: worth +31 to you · costs his team 0.7 pts/wk</span><span class="sr-only">Cornelius Snoot (RB): worth 31.2 more lineup pts (playoffs count ${w}×) to Moonbeam Mudcats (your team) than to his own team. Moonbeam Mudcats (your team) would gain 35.2 with him (after its free-agent pickups); his team would lose 4 without him, 0.7 a week.</span>`,
    );
    // A starter: a visible "starter" tag inside the chip (hidden from screen readers, whose text says it in words).
    expect(html).toMatch(
      /<span aria-hidden="true">I\. Fumblewick: worth \+18 to Tundra Tortoises · costs his team 1\.6 pts\/wk<span class="[^"]*uppercase[^"]*">starter<\/span><\/span><span class="sr-only">Ignatius Fumblewick \(RB\): [^<]*his team would lose 9 without him, 1\.6 a week\. He starts for his team\.<\/span>/,
    );
    expect(html.match(/>starter<\/span>/g)).toHaveLength(2 + 2 + 1 + 1); // team 2's two starters shown, team 3's two, team 4's, and the key's sample
    expect(html).toMatch(/title="Need at WR \(next 4 weeks\)[^"]*" class="[^"]*border-dashed/);
    // Checkpoint 7h (the lead's step 2 for the League page): the chips' names on one line, a 44 px disclosure button named by the
    // team, the pills under it on a tap (in the page while closed, hidden).
    expect(text).toContain("Trade chips C. Snoot, I. Fumblewick, P. Plunk (Gravel Gophers) C. Snoot: worth +31 to you · costs his team 0.7 pts/wk");
    expect(html).toMatch(
      /<button type="button" aria-expanded="false" aria-controls="([^"]+)" class="[^"]*min-h-11[^"]*">[^]*?<span class="font-semibold text-muted">Trade chips<\/span> <span class="[^"]*">C\. Snoot, I\. Fumblewick, P\. Plunk<\/span><span class="sr-only"> \(Gravel Gophers\)<\/span><\/span><\/button><div id="\1" hidden="">/,
    );
    expect(text).toContain("W. Spoons: worth +15 to Gravel Gophers · costs you 0.3 pts/wk");
    expect(text).toContain("trade chip: worth at least 10 more lineup pts to another team than to his own");
    // The key explains the tag, in words for screen readers too.
    expect(html).toMatch(/<span class="sr-only">starter tag: <\/span>he starts for his own team<\/li>/);
    expect(text).not.toMatch(/surplus/i);
  });

  it("hides the wide-only columns on phones (375 px)", () => {
    expect(html).toMatch(/<th scope="col" class="hidden [^"]*sm:table-cell"><abbr title="Points for, so far">PF<\/abbr><\/th>/);
    expect(html).toMatch(/<th scope="col" class="hidden [^"]*sm:table-cell"><abbr title="[^"]*">ROS pts<\/abbr><\/th>/);
  });
});

describe("LeagueView heatmap", () => {
  it("is closed by default, its heading the 44 px control that opens it, the table in the page while closed (Checkpoint 7h)", () => {
    const card = between(html, ">Lineup slots<", "Trade partners");
    const control = /<h2 class="[^"]*"><button type="button" aria-expanded="false" aria-controls="([^"]+)" data-league-disclosure="heatmap" class="([^"]*)"><span class="[^"]*">Positional strength<\/span><span aria-hidden="true" class="[^"]*">▾<\/span><\/button><\/h2><div id="\1" hidden="" class="mt-3">/.exec(card);
    expect(control).not.toBeNull();
    expect(control?.[2]).toMatch(/(^|\s)min-h-11(\s|$)/);
    expect(control?.[2]).toMatch(/(^|\s)w-full(\s|$)/);
    expect(card).toContain('aria-label="Positional strength table');
  });

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
  const partners = between(html, "Best fits for your team", 'id="rosters-title"');
  /** One partner card's visible text, from its team's name up to its "See trade ideas" link. */
  const cardText = (markup: string, team: string) => textOf(between(markup, `>${team}<`, "See trade ideas").slice(1)).trim();

  it("leads each card with who to aim for, then each side's other trade chips (planner addendum to Checkpoint 3, §2)", () => {
    expect(textOf(partners)).toContain(
      "Gravel Gophers Fit 2.4 Best of their trade chips: C. Snoot, +2.1/wk Bigger upgrade, harder to get: M. Gloop, +2.5/wk ▸ More players (Gravel Gophers) They could also give: I. Fumblewick (+1.2/wk), P. Plunk (+0.5/wk), P. Wobbleton (+0.4/wk) Harder to get You could give: W. Spoons (+1.8/wk)",
    );
    // Each lead line says on hover what he'd add to my lineup (and why he's harder to get).
    // The name and the number each stay on one line (a hyphenated name broke at 375 px).
    expect(partners).toContain(
      '<p class="mt-1.5 text-sm leading-relaxed" title="Cornelius Snoot: +2.1 points per week to your lineup."><span class="font-semibold text-muted">Best of their trade chips:</span> <span class="font-bold"><span class="whitespace-nowrap">C. Snoot,</span> <span class="whitespace-nowrap">+2.1/wk</span></span></p>',
    );
    expect(partners).toMatch(
      /<p [^>]*title="Mortimer Gloop: \+2\.5 points per week to your lineup\. Harder to get: [^"]*"><span class="font-semibold text-muted">Bigger upgrade, harder to get:<\/span> <span class="font-bold"><span class="whitespace-nowrap">M\. Gloop,<\/span> <span class="whitespace-nowrap">\+2\.5\/wk<\/span><\/span><\/p>/,
    );
    // A one-sided fit is badged by what was measured, and says plainly what it would cost.
    // Checkpoint 7h (the lead's step 5 for the League page): what else each side could give behind a 44 px "More players".
    expect(partners).toMatch(/<button type="button" aria-expanded="false" aria-controls="([^"]+)" class="[^"]*min-h-11[^"]*"><span aria-hidden="true"[^>]*>▸<\/span><span>More players<span class="sr-only"> \(Gravel Gophers\)<\/span><\/span><\/button><div id="\1" hidden="">/);
    expect(text).toContain("Tundra Tortoises Would start for you Best of their trade chips: O. Wren, +1.6/wk ▸ More players (Tundra Tortoises) You could give: no trade chip that would start for them, so a trade would likely cost you a starter.");
    // No empty "They could also give:" line when the targets are all of them.
    expect(textOf(between(partners, ">Tundra Tortoises<", "See trade ideas"))).not.toContain("They could");
    // Under the floor (config.needs.bestTargetMin, lead decision N12) and untagged, Mop leads nothing: he's simply listed, on the
    // card itself since it has no lead line (⚠️ ours, Checkpoint 7h), mine behind "More players".
    expect(cardText(partners, "Quasar Quokkas")).toBe("Quasar Quokkas Fit 1.1 They could give: L. Mop (+0.9/wk) ▸ More players (Quasar Quokkas) You could give: W. Spoons (+1.3/wk)");
    expect(text).not.toContain("Fills your needs");
    expect(text).toContain("Points per week are what each trade chip would add to the other team's starting lineup, after that team's free-agent pickups.");
    expect(text).toContain("teams with a trade chip who would start for you, when none of yours would start for them, come last.");
    expect(text).toContain(
      "come last. “Best of their trade chips” is the one of their trade chips who'd help you most without the “Harder to get” mark, as long as he adds at least 1 point a week; when none does, a marked one who'd help you more leads instead, if he adds at least that much too. A marked player is one of their best, so expect their manager to want a little extra for him. “See trade ideas” opens the Trade Finder for that team: actual trades, ranked by how much they help you and how likely that team is to say yes, which can differ from the trade chips named here.",
    );
    expect(text).not.toContain("Best target");
  });

  it("ends each card with 'See trade ideas with <team> →': a 44 px link that wraps a long name, its arrow hidden from screen readers (planner reply to Checkpoint 4, change 6)", () => {
    const links = [...partners.matchAll(/<a class="([^"]*)" href="([^"]*)">See trade ideas with ([^<]*)<span aria-hidden="true"> →<\/span><\/a>/g)].map(([, cls = "", href, team]) => ({ href, team, target: cls.includes("min-h-11"), wraps: cls.includes("wrap-anywhere") }));
    expect(links).toEqual([
      { href: "/trades?partner=2", team: "Gravel Gophers", target: true, wraps: true },
      { href: "/trades?partner=3", team: "Quasar Quokkas", target: true, wraps: true },
      { href: "/trades?partner=4", team: "Tundra Tortoises", target: true, wraps: true },
    ]);
  });

  it("leads with the tagged one alone, as 'Best of their trade chips, harder to get', when no untagged one adds the floor (lead decision N12)", () => {
    // The review's Team 1 card in Parker's league: an untagged +0.1/wk next to a tagged +7.2/wk (made-up names here).
    const f = leagueFixture();
    f.model.partners = f.model.partners.map((p) =>
      p.teamId === "2"
        ? {
            ...p,
            theyCanGive: [
              { playerId: "202", ppw: 7.2 },
              { playerId: "204", ppw: 0.1 },
            ],
          }
        : p,
    );
    const page = between(renderFixture(f), "Best fits for your team", 'id="rosters-title"');
    expect(cardText(page, "Gravel Gophers")).toBe("Gravel Gophers Fit 2.4 Best of their trade chips, harder to get: M. Gloop, +7.2/wk ▸ More players (Gravel Gophers) They could also give: C. Snoot (+0.1/wk) You could give: W. Spoons (+1.8/wk)");
    const card = between(page, ">Gravel Gophers<", "See trade ideas");
    expect(card).toMatch(
      /<p [^>]*title="Mortimer Gloop: \+7\.2 points per week to your lineup\. Harder to get: [^"]*"><span class="font-semibold text-muted">Best of their trade chips, harder to get:<\/span> <span class="font-bold"><span class="whitespace-nowrap">M\. Gloop,<\/span> <span class="whitespace-nowrap">\+7\.2\/wk<\/span><\/span><\/p>/,
    );
    expect(card).not.toContain("Bigger upgrade");
  });

  it("marks their harder-to-get players in the list in words (a gold pill, why on hover), never mine", () => {
    expect(partners).toMatch(
      /<span title="Pip Wobbleton: \+0\.4 points per week to the other lineup\. Harder to get: [^"]*">, P\. Wobbleton \(\+0\.4\/wk\)<span title="Harder to get: his team&#x27;s second most valuable player[^"]*" class="ml-1"><span class="[^"]*bg-accent text-navy[^"]*">Harder to get<\/span><\/span><\/span>/,
    );
    expect(textOf(between(partners, "You could give:", "See trade ideas"))).not.toContain("Harder to get");
  });

  it("names the rest counted on hover and for screen readers, saying which are harder to get", () => {
    const f = leagueFixture();
    f.model.partners = f.model.partners.map((p) =>
      p.teamId === "2"
        ? {
            ...p,
            theyCanGive: [
              { playerId: "204", ppw: 2.1 },
              { playerId: "203", ppw: 1.2 },
              { playerId: "205", ppw: 0.5 },
              { playerId: "206", ppw: 0.46 },
              { playerId: "201", ppw: 0.4 },
            ],
          }
        : p,
    );
    const more = between(renderFixture(f), "Best fits for your team", 'id="rosters-title"');
    expect(textOf(more)).toContain("Gravel Gophers Fit 2.4 Best of their trade chips: C. Snoot, +2.1/wk ▸ More players (Gravel Gophers) They could also give: I. Fumblewick (+1.2/wk), P. Plunk (+0.5/wk), R. Wimbleton (+0.5/wk) and 1 more");
    expect(more).toMatch(/<span title="Pip Wobbleton: [^"]*" class="text-muted"> <span aria-hidden="true">and 1 more<\/span><span class="sr-only">and 1 more: P\. Wobbleton \(\+0\.4\/wk, harder to get\)<\/span><\/span>/);
  });
});

describe("LeagueView 'Harder to get' (planner addendum to Checkpoint 3, §2)", () => {
  const PILL = '<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap bg-accent text-navy align-middle">Harder to get</span>';

  it("puts a gold 'Harder to get' pill on another team's player's position line, inside his button (part of its name), why on hover", () => {
    expect(html).toMatch(
      new RegExp(
        `<span class="font-bold break-words">Mortimer Gloop</span></span><span class="block pl-4 text-xs text-muted">RB · DET · bye done<span title="Harder to get: his team&#x27;s most valuable player and one of the top 12 players by trade value, so his manager will likely want a little extra for him\\." class="ml-1">${PILL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}</span></span><span class="sr-only">, week by week</span></button>`,
      ),
    );
    // Team 2's and 3's and 4's two each; none on my roster or among the free agents.
    const rosters = between(html, 'id="rosters-title"', "Best available");
    expect(rosters.match(/>Harder to get<\/span>/g)).toHaveLength(6);
    expect(between(rosters, "Moonbeam Mudcats", "Gravel Gophers")).not.toContain("Harder to get");
    expect(between(html, "Best available", "How these numbers work")).not.toContain("Harder to get");
  });

  it("tags another team's trade chip in the table with a gold pill after 'starter', and adds it to the key only when one shows", () => {
    const teams = between(html, "Projected strength", "Positional strength");
    expect(teams).toMatch(
      /<span aria-hidden="true">O\. Kettleburn: worth \+12 to Tundra Tortoises · costs his team 5\.2 pts\/wk<span class="[^"]*bg-brand text-brand-contrast[^"]*">starter<\/span><span class="[^"]*bg-accent text-navy[^"]*">Harder to get<\/span><\/span><span class="sr-only">[^<]*He starts for his team\. Harder to get: his team&#x27;s second most valuable player[^<]*<\/span>/,
    );
    expect(teams).toMatch(/<span class="sr-only">Harder to get tag: <\/span>his manager will likely want a little extra for him<\/li>/);
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => ({ ...t, premiums: undefined }));
    const none = renderFixture(f);
    expect(none).not.toContain(">Harder to get</span>");
    expect(none).not.toContain("bg-accent text-navy");
    expect(none).not.toContain("Harder to get tag");
  });

  it("explains it in 'How these numbers work'", () => {
    expect(text).toContain("Harder to get Managers value their own best players a bit above their trade value.");
  });
});

describe("LeagueView rosters", () => {
  it("says above the rosters how free agents are shared out, one team each (planner reply to Checkpoint 4, change 3), only when the model says", () => {
    const f = leagueFixture();
    f.model = { ...f.model, faAllocation: { basis: "faab", order: ["2", "1", "3", "4"] } };
    const head = between(renderFixture(f), 'id="rosters-title"', "<details");
    // The fixture's snapshot reports no budgets, so the order used can't be named: the basis in words, no second line.
    // Checkpoint 7h: behind the rosters' "Why?" (their intro is one line).
    expect(head).toContain('<p class="break-words">Free-agent pickups: each free agent goes to one team only, in FAAB order (the most budget left first). Your team picks 2nd of 4.</p>');
    expect(head).toMatch(/<p class="min-w-0 flex-1 leading-relaxed">Rest-of-season \(ROS\) points count only the games left\. <a [^>]*>Values: FantasyCalc[^]*?<\/a><\/p><button type="button" aria-expanded="false" aria-controls="([^"]+)" class="[^"]*min-h-11[^"]*">Why\?<span class="sr-only"> \(the rosters\)<\/span><\/button><\/div><div id="\1" hidden=""/);
    expect(head).not.toContain("Waiver order used");
    // A model built before Phase 4b (the fixture's): no line.
    expect(between(html, 'id="rosters-title"', "<details")).not.toContain("one team only");
  });

  it("names the waiver order used under it, as the Import Report's row does (planner reply to Checkpoint 4b, change 5)", () => {
    const f = leagueFixture();
    const ranks: Record<string, number> = { "3": 1, "2": 2, "1": 3, "4": 4 };
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, waiverOrderUsed: "weeklyReset" }, teams: f.snapshot.teams.map((t) => ({ ...t, waiverRank: ranks[t.id] as number })) };
    f.model = { ...f.model, faAllocation: { basis: "waiver", order: ["3", "2", "1", "4"] } };
    const head = between(renderFixture(f), 'id="rosters-title"', "<details");
    // The Import Report's own words (importReport.ts waiverOrderText, pinned there).
    expect(head).toContain(
      `<p class="break-words">Free-agent pickups: each free agent goes to one team only. Your team picks 3rd of 4.</p><p class="break-words"><span class="font-semibold">Waiver order used:</span> ${waiverOrderText(f.snapshot).replace(/'/g, "&#x27;")}</p>`,
    );
    expect(textOf(head)).toMatch(/Waiver order used: Weekly reset/i);
  });

  it("says in an inactive team's roster header that no pickups are assumed for it, so it shows while collapsed (planner reply to Checkpoint 4c, A4)", () => {
    // Week 12: only Team 2 made a move in the last 5 weeks; Teams 3 and 4 are inactive (my team never is).
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, transactions: [{ id: "d2", type: "drop", week: 11, timestamp: "2026-11-20T00:00:00Z", teams: ["2"], moves: [{ playerId: "x", from: "2", to: null }] }] };
    f.model = { ...f.model, faAllocation: { basis: "waiver", order: ["3", "2", "1", "4"] } };
    const summaries = [...renderFixture(f).matchAll(/<summary[^>]*>(.*?)<\/summary>/g)].map((m) => m[1] ?? "");
    const line = '<span class="mt-1 block text-xs break-words text-muted">Inactive: no transactions in the last 5 weeks, so no free-agent pickups are assumed.</span>';
    for (const [name, inactive] of [
      ["Moonbeam Mudcats", false],
      ["Gravel Gophers", false],
      ["Quasar Quokkas", true],
      ["Tundra Tortoises", true],
    ] as const) {
      const s = summaries.find((x) => x.includes(name)) ?? "";
      expect(s.includes(line), name).toBe(inactive);
    }
  });

  it("collapses every roster, mine too (Checkpoint 7h: toward about 8 screens), my summary showing my points a week, ROS points and pickups", () => {
    expect(html).not.toContain("<details open");
    expect(html).toMatch(/<details class="[^"]*"><summary[^>]*><span[^>]*><span[^>]*>Moonbeam Mudcats <span[^>]*>You<\/span><\/span><span[^>]*>87 pts\/wk · 438 ROS pts<\/span>/);
    const mine = between(html, "Moonbeam Mudcats <span", "</summary>");
    expect(mine).toContain("Free-agent pickups that would help:");
    // The returns, locks and Expected back selects are in its body (the page's settings edits give them: PlayerTable.test.ts).
    expect(between(html, "Moonbeam Mudcats <span", "</details>")).toContain("Moonbeam Mudcats: players with rest-of-season points");
    expect(html.match(/<details/g)).toHaveLength(5); // 4 rosters + how these numbers work
  });

  it("heads each roster with its free-agent pickups (how many, what they add), highlighted for mine, so they show while collapsed, and lists them in its body", () => {
    const summaries = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary>/g)].map((m) => m[1] ?? "");
    const mine = summaries.find((s) => s.includes("Moonbeam Mudcats")) ?? "";
    // The gains count each week once (planner reply to Checkpoint 7b, Q6: Waiver upgrades' number): no "(playoffs count
    // N×)" after them, where lineup cost (below) keeps its weight.
    expect(mine).toContain(
      '<span title="Free-agent pickups that would help: add Floopy Freeman (RB, CAR), drop Tobias Thimble: +3.3 lineup pts" class="mt-2 block rounded-lg bg-brand-soft',
    );
    expect(mine).toMatch(/<span class="font-bold">Free-agent pickups that would help:<\/span> <span class="whitespace-nowrap tabular-nums font-extrabold">1, \+3\.3 lineup pts<\/span><\/span>/);
    const theirs = summaries.find((s) => s.includes("Quasar Quokkas")) ?? "";
    expect(theirs).toMatch(/<span title="[^"]*" class="mt-1 block text-xs break-words text-muted"><span class="font-bold">Free-agent pickups that would help:<\/span> <span[^>]*>2, \+5\.5 lineup pts<\/span><\/span>/);
    // No pickup that helps: no line. And a gain is never labeled like the plain ROS points beside it, nor weighted.
    const lines = summaries.filter((s) => s.includes("Free-agent pickups")).map((s) => s.slice(s.indexOf("Free-agent pickups")));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain("ROS pts");
      expect(line).not.toContain("playoffs count");
    }
    // The body lists them in order, as a real list under a heading that names the team for screen readers.
    const body = between(html, '<span class="block font-extrabold break-words">Quasar Quokkas', "</details>");
    expect(body).toContain('<h3 class="text-sm font-extrabold">Free-agent pickups that would help<span class="sr-only"> for Quasar Quokkas</span></h3>');
    expect(body).toMatch(
      /<ol class="mt-1 list-decimal [^"]*"><li title="Add Waverly Waiver \(RB, NE\) into an open spot: \+2\.9 lineup pts on projected lineups, each week counted once\." class="break-words">add Waverly Waiver \(RB, NE\) into an open spot: <span class="whitespace-nowrap font-semibold tabular-nums">\+2\.9 lineup pts<\/span><\/li><li[^>]*>add Floopy Freeman \(RB, CAR\), drop Barnaby Tuft: <span[^>]*>\+2\.6 lineup pts<\/span><\/li><\/ol><\/div>/,
    );
    expect(body).not.toContain("Lineup pts (playoffs count");
    // The weight as the page prints it, one decimal (planner reply to Checkpoint 7a, §6.1): lineup cost keeps it.
    const w = playoffWeightLabel(config.lineups.playoffWeight);
    expect(text).toContain("Lineup cost is how many his team would lose without him");
    expect(html).toContain(`<abbr title="Rest-of-season lineup points his team would lose without him, with playoff weeks counted ${w}×">Lineup cost</abbr>`);
  });

  it("Checkpoint 7f (planner reply to Checkpoint 7e, answer 4; the lead's R2): lists whom the odds release at each of my IR returns after my pickups, with why when the near-tie rule decided it, on my roster card only", () => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) =>
      t.id === "1" ? { ...t, displacedWithPickups: [{ id: "108", week: 15, returner: "107", keptInstead: "106" }] } : t.id === "2" ? { ...t, displacedWithPickups: [{ id: "205", week: 16, returner: "206" }] } : t,
    );
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const page = renderToStaticMarkup(createElement(LeagueView, { view, refresh }));
    const mine = between(page, '<span class="block font-extrabold break-words">Moonbeam Mudcats', "</details>");
    // After the pickups, before the players, under a heading that names the team for screen readers; the list marked as
    // roster moves, which check:browser reads alone (review of Checkpoint 7f, PIERCE-1), and its lock on this card.
    expect(mine).toContain(
      '<h3 class="text-sm font-extrabold">Returns from IR<span class="sr-only"> for Moonbeam Mudcats</span></h3><ul data-roster-moves="returns" class="mt-1 list-disc space-y-0.5 pl-5 text-sm leading-snug"><li class="break-words">Week 15, when Humbert Fiddlesticks returns from IR: release Tobias Thimble (TE). From week 15 on, he and Wiggleton Spoons add about the same to your starting lineup, and Spoons has more trade value. Lock Thimble to keep him instead.</li></ul>',
    );
    expect(mine.indexOf("Free-agent pickups that would help<span")).toBeLessThan(mine.indexOf("Returns from IR"));
    expect(mine.indexOf("Returns from IR")).toBeLessThan(mine.indexOf("<table"));
    // Another team's release: nothing on its card (the default fixture has none at all).
    expect(between(page, '<span class="block font-extrabold break-words">Gravel Gophers', "</details>")).not.toContain("Returns from IR");
    expect(page.match(/Returns from IR/g)).toHaveLength(1);
    expect(html).not.toContain("Returns from IR");
  });

  it("makes each player's name cell the row header, so moving down a column says whose number it is", () => {
    const rows = [...html.matchAll(/<tr class="border-b border-line"><(t[hd])[^>]*>/g)];
    // Every player row in every roster and free-agent table: 9 + 7 + 7 + 6 rostered, 5 free agents (2 RBs, a WR, 2 D/STs).
    expect(rows).toHaveLength(34);
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
    expect(html).toMatch(new RegExp(`<tr id="${button?.[1]}" hidden="" class="border-b border-line"><td colSpan="5"[^>]*></td></tr>`, "i"));
    // Every disclosure controls its own breakdown.
    const ids = [...html.matchAll(/aria-controls="(weeks-[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("heads the IR and taxi groups with row-group headers over their own rows, and names the group in each of those players' buttons", () => {
    expect(html).not.toContain('scope="colgroup"');
    // The heading and its players share one row group (tbody).
    const irGroups = [...html.matchAll(/<tbody><tr><th scope="rowgroup" colSpan="5"[^>]*>Injured reserve<\/th><\/tr>([\s\S]*?)<\/tbody>/g)].map((m) => m[1] ?? "");
    expect(irGroups).toHaveLength(2);
    expect(irGroups[0]).toContain("Humbert Fiddlesticks");
    // A Doubtful player in an IR slot: his badge says Doubtful, so the group name is what says IR.
    expect(irGroups[1]).toMatch(/<span class="font-bold break-words">Rupert Wimbleton<\/span><\/span><span class="sr-only">, injured reserve<\/span><span class="block pl-4 text-xs text-muted">RB · PIT · bye done<span[^>]*><span aria-hidden="true">D<\/span><span class="sr-only">Doubtful<\/span><\/span><\/span>/);
    expect(html).toMatch(/<tbody><tr><th scope="rowgroup" colSpan="5"[^>]*>Taxi squad<\/th><\/tr><tr[^>]*><th scope="row"[^>]*><button[^>]*>.*?Ferdinand Puddle<\/span><\/span><span class="sr-only">, taxi squad<\/span>/);
    // Active players' buttons say no group.
    expect(between(html, "Fizzwick Pemberton", "</button>")).not.toMatch(/injured reserve|taxi squad/);
  });

  it("opens into the columns phones hide and a captioned week-by-week table, a game under way shown like a bye", () => {
    const f = leagueFixture();
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const qb = view.rosters[0]?.players.find((p) => p.id === "101");
    if (!qb) throw new Error("fixture QB missing");
    const detail = renderToStaticMarkup(createElement(PlayerDetail, { player: qb, showLineupCost: true }));
    expect(textOf(detail)).toContain("Games left 5 games Lineup cost 58.2");
    // No trade value (planner reply to Checkpoint 7a, 5.4).
    expect(textOf(detail)).not.toMatch(/Value|7,342/);
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

  it("says at the top of a blended player's breakdown which way the trade market moved his projection (§6 step 8), in words with how it works under them (phones have no hover), never a number of the market's (planner reply to Checkpoint 7a, 5.4)", () => {
    const f = leagueFixture();
    const pm = f.model.players["101"];
    if (!pm) throw new Error("fixture QB missing");
    f.model.players["101"] = { ...pm, blend: { ours: 210.4, market: 169.6, used: 190, weight: 0.5 } };
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const qb = view.rosters[0]?.players.find((p) => p.id === "101");
    if (!qb) throw new Error("fixture QB missing");
    const detail = renderToStaticMarkup(createElement(PlayerDetail, { player: qb, showLineupCost: true }));
    expect(detail).toMatch(
      /<p class="mb-2 text-xs leading-relaxed break-words"><span class="font-medium">His projection leans down toward the trade market&#x27;s view\.<\/span><span class="block text-muted">Per game, his projection moves halfway toward [^<]*<\/span><\/p>/,
    );
    // The words are on screen for everyone, not in a hover or screen-reader-only text.
    expect(detail).not.toMatch(/title="Per game/);
    expect(textOf(detail)).toContain("His projection leans down toward the trade market's view. Per game, his projection moves halfway toward what our model gives healthy players with about the same trade value");
    // Neither the market's number (170) nor ours before the blend (210), which gives it back with his ROS.
    expect(textOf(detail)).not.toMatch(/Our projection|Trade market \d|\b170\b|\b210\b/);
    // An unblended player's breakdown has no such line.
    const rb = view.rosters[0]?.players.find((p) => p.id === "102");
    if (!rb) throw new Error("fixture RB missing");
    expect(renderToStaticMarkup(createElement(PlayerDetail, { player: rb, showLineupCost: true }))).not.toContain("trade market");
  });

  it("shows no trade value, FantasyCalc's own, our estimates or the flat minimum (planner reply to Checkpoint 7a, 5.4)", () => {
    expect(html).not.toMatch(/~\d|7,342|\(our estimate\)|\(our minimum value\)/);
    expect(html).not.toContain(">Value</th>");
  });
});

describe("LeagueView free agents and the explainer", () => {
  it("is closed by default, its heading the 44 px control that opens it, the tables in the page while closed (Checkpoint 7h)", () => {
    const card = between(html, ">Free agents<", "How these numbers work");
    const control = /<h2 class="[^"]*"><button type="button" aria-expanded="false" aria-controls="([^"]+)" data-league-disclosure="free-agents" class="([^"]*)"><span class="[^"]*">Best available<\/span><span aria-hidden="true" class="[^"]*">▾<\/span><\/button><\/h2><div id="\1" hidden="" class="mt-3">/.exec(card);
    expect(control).not.toBeNull();
    expect(control?.[2]).toMatch(/(^|\s)min-h-11(\s|$)/);
    expect(card).toContain("Best free agents at RB by rest-of-season points");
  });

  it("lists the best free agents by position, without a lineup cost", () => {
    expect(text).toContain("Free agents Best available ▾ The best at each position by rest-of-season points. Values: FantasyCalc");
    expect(html).toContain('<caption class="sr-only">Best free agents at RB by rest-of-season points</caption>');
    expect(between(html, "Best available", "How these numbers work")).not.toContain("Lineup cost");
  });

  it("shows the best config.leaguePage.freeAgentsShown a position, the rest behind one 44 px “Show all” (Checkpoint 7h, the lead's step 3)", () => {
    const f = leagueFixture();
    const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const shown = config.leaguePage.freeAgentsShown;
    // Three players a position, from the fixture's rows (the layout's rule doesn't read who they are).
    const rows = view.freeAgents.flatMap((g) => g.players);
    const many = { ...view, freeAgents: view.freeAgents.map((g) => ({ ...g, players: [0, 1, 2].map((i) => ({ ...(rows[i % rows.length] as (typeof rows)[number]), id: `${g.pos}-${i}` })) })) };
    const page = between(renderToStaticMarkup(createElement(LeagueView, { view: many, refresh })), "Best available", "How these numbers work");
    expect((page.match(/<tbody/g) ?? []).length).toBe(many.freeAgents.length);
    expect((page.match(/<th scope="row"/g) ?? []).length).toBe(many.freeAgents.length * shown);
    expect(page).toMatch(new RegExp(`<button type="button" aria-expanded="false" data-free-agents-all="" class="[^"]*min-h-11[^"]*">Show all ${many.freeAgents.length * 3}<span class="sr-only"> free agents</span></button>`));
    // No button when every position fits.
    const few = { ...view, freeAgents: view.freeAgents.map((g) => ({ ...g, players: g.players.slice(0, shown) })) };
    expect(between(renderToStaticMarkup(createElement(LeagueView, { view: few, refresh })), "Best available", "How these numbers work")).not.toContain("Show all");
  });

  it("explains the numbers and where they came from", () => {
    expect(html).toMatch(/<summary[^>]*>How these numbers work<span/);
    // The League model's seasons since Checkpoint 7e (the shown block, config.simulation.shownSims; the fixture's).
    expect(text).toContain("Playoff odds We play out the rest of the season 20,000 times.");
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

describe("LeagueView streaming picks (§7 streaming positions; planner reply to Checkpoint 3, model change 1)", () => {
  const card = between(html, "Streaming picks this week", 'id="rosters-title"');

  it("lists this week's picks per position in a captioned table, the player as each row's header, the opponent said in words", () => {
    expect(card).toContain('<caption class="sr-only">Best free-agent D/STs for week 12, by this week&#x27;s projection</caption>');
    expect(card).toContain('<abbr title="This week&#x27;s opponent">Opp</abbr>');
    expect(card).toContain('<abbr title="Projected points this week">Proj</abbr>');
    expect([...card.matchAll(/<th scope="row"[^>]*>([^<]+) <span[^>]*>([A-Z]+)<\/span><\/th>/g)].map((m) => [m[1], m[2]])).toEqual([
      ["Seahawks D/ST", "SEA"],
      ["Giants D/ST", "NYG"],
    ]);
    expect(card).toContain('<td class="py-2 pr-2 whitespace-nowrap" title="at home against ARI"><span aria-hidden="true">vs ARI</span><span class="sr-only">at home against ARI</span></td>');
    expect(card).toContain('<span aria-hidden="true">@ DAL</span><span class="sr-only">away at DAL</span>');
    expect(textOf(card)).toContain("Seahawks D/ST SEA vs ARI at home against ARI 8.2");
    // No kicker slot in this league: no kicker table.
    expect(card).not.toContain("kickers for week");
  });

  it("says what I stream with a link to Settings (a 44 px target), which other teams stream, and how a streamed slot counts", () => {
    expect(card).toMatch(/<p>You stream D\/ST\. <a [^>]*href="\/settings"[^>]*>Change it in Settings<\/a><\/p>/);
    expect(card).toMatch(/<a [^>]*class="inline-flex min-h-11[^"]*"[^>]*>Change it in Settings/);
    expect(textOf(card)).toContain("Other teams that stream (2 or more adds at the position this season): Quasar Quokkas (D/ST, 3 adds).");
    expect(textOf(card)).toContain("A streamed slot counts, each week, the better of the team's own player and the streaming replacement: the 3rd-best free agent at that position that week");
    // Without a team of mine: no "You stream" line, no Settings link.
    const none = between(render({ myTeamId: null }), "Streaming picks this week", 'id="rosters-title"');
    expect(none).not.toContain("You stream");
    expect(none).not.toContain('href="/settings"');
    expect(textOf(none)).toContain("Teams that stream (2 or more adds at the position this season): Quasar Quokkas (D/ST, 3 adds).");
  });

  it("says so when no free agent is projected to play this week, and isn't there once the season is over", () => {
    const f = leagueFixture();
    f.model.streaming = { ...f.model.streaming, picks: [] };
    const empty = between(renderFixture(f), "Streaming picks this week", 'id="rosters-title"');
    expect(textOf(empty)).toContain("None projected to play this week.");
    expect(textOf(empty)).toContain("No free-agent D/STs are projected to play this week.");
    const over = leagueFixture();
    over.model = { ...over.model, weeks: [], regularWeeks: [], playoffWeeks: [], inProgressWeek: null, odds: null, teams: over.model.teams.map((t) => ({ ...t, ev: { lv: [], ros: 0, ppw: 0 }, scen: null })) };
    expect(renderFixture(over)).not.toContain("Streaming picks this week");
  });

  it("heads each roster with what its team streams", () => {
    const rosters = between(html, 'id="rosters-title"', "Best available");
    expect(rosters).toContain('<span class="block text-xs break-words text-muted">Streams D/ST (your setting)</span>');
    expect(rosters).toContain('<span class="block text-xs break-words text-muted">Streams D/ST (3 adds this season)</span>');
    expect(rosters.match(/>Streams /g)).toHaveLength(2);
  });
});

describe("the lock's words over my roster (the final review of Checkpoint 7e, UI-F-3)", () => {
  it("say what the lock on my players' rows does, only where the locks are: with the League page's settings edits and a team of mine", async () => {
    const { LeagueSettingsEditContext } = await import("./leagueSettingsEdit");
    const { LOCK_HELP } = await import("./UntouchableLock");
    const { defaultTradeSettings } = await import("@/engine/settings");
    expect(LOCK_HELP).toBe("The lock next to one of your players makes him untouchable: trade ideas never offer him, and he's never suggested as a drop.");
    const withEdits = (f: LeagueFixture) => {
      const view = buildLeagueView({ ...f, myTeamSource: f.model.myTeamId ? "platform" : "none", timeZone: "America/Chicago", now: NOW });
      return renderToStaticMarkup(createElement(LeagueSettingsEditContext, { value: { leagueKey: "test-league", settings: defaultTradeSettings(), season: f.snapshot.season } }, createElement(LeagueView, { view, refresh })));
    };
    const rosters = between(withEdits(leagueFixture()), 'id="rosters-title"', "Best available");
    // Not a hover: behind the rosters' "Why?" since Checkpoint 7h (⚠️ ours: their intro is one line), and the locks are there.
    expect(rosters).toContain(`<p>${LOCK_HELP.replace(/'/g, "&#x27;")}</p>`);
    expect(rosters.indexOf("(the rosters)")).toBeLessThan(rosters.indexOf(LOCK_HELP.slice(0, 20)));
    expect(rosters).toContain('aria-label="Untouchable: ');
    // No locks, no words: without the League page's settings edits, or without a team of mine.
    expect(textOf(html)).not.toContain(LOCK_HELP);
    expect(textOf(withEdits(leagueFixture({ myTeamId: null })))).not.toContain(LOCK_HELP);
  });
});
