/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2; WaiverUpgrades.tsx), rendered statically (no
 * DOM, first render only), from a made-up league run through the engine: the section the header's link goes to
 * (id "waivers", its heading focusable from script so the link can move focus there: review of the Waivers link), the
 * toggle (44 px, aria-pressed; three lists while a week is under way, wrapping rather than overflowing), the first
 * config.waivers.rowsShown rows and "Show all", tags in words, the 375 px rules (cards that wrap, no table), and its place
 * on the League page (from the page's context, after the trade partners).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { buildLeagueModel, type LeagueModelConfig } from "@/engine/league";
import type { Pos } from "@/engine/model";
import { TEST_NOW, buildTestLeague, type TestPlayer } from "@/engine/testLeague";
import { buildLeagueView } from "@/lib/leagueView";
import { DEPTH_ONLY_TAG, WAIVERS_SECTION_ID, buildWaiversView, type WaiversView } from "@/lib/waiversView";
import { LeagueView } from "./LeagueView";
import { WaiverUpgrades, WaiverUpgradesCard, WaiversViewContext } from "./WaiverUpgrades";
import { NOW, leagueFixture } from "./testFixtures";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
const p = (id: string, pos: Pos, points: number, name: string, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, name, ...extra });

const MINE: TestPlayer[] = [
  p("q1", "QB", 20, "Quinn Arrow"),
  p("r1", "RB", 15, "Rudy Bolt"),
  p("r2", "RB", 12, "Reggie Dash"),
  p("r3", "RB", 2, "Ronnie Slow"),
  p("w1", "WR", 14, "Wes Catch"),
  p("w2", "WR", 11, "Walt Hands"),
  p("w3", "WR", 2, "Wade Route"),
  p("t1", "TE", 8, "Ty Block"),
  p("k1", "K", 8, "Kip Boot"),
  p("d1", "DEF", 7, "Ducks D/ST"),
];

/**
 * A league with more listed free agents than the page shows at first (rowsShown), one of them out. `underWay`: week 4 is
 * under way (one team's game has kicked off, the rest play later), so there are three lists.
 */
function waiversView(underWay = false): WaiversView {
  const fas = Array.from({ length: config.waivers.rowsShown + 2 }, (_, i) => p(`fa${i}`, i % 2 ? "WR" : "RB", 3 + i, `Free Agent Number${i}`));
  fas.push(p("fo", "WR", 12, "Oscar Hurt", { injury: "OUT" }));
  const kickoffs = underWay ? { 4: { EAR: new Date(TEST_NOW.getTime() - 3_600_000).toISOString(), AAA: new Date(TEST_NOW.getTime() + 86_400_000).toISOString() } } : undefined;
  const l = buildTestLeague({ platform: "espn", teams: [{ id: "1", roster: MINE }, { id: "2", roster: [p("q2", "QB", 18, "Other QB", { nflTeam: "EAR" })] }], freeAgents: fas, ...(kickoffs ? { kickoffs } : {}) });
  const model = buildLeagueModel(l.snapshot, l.inputs, { now: TEST_NOW, sims: 0 }, NO_RISK);
  const v = buildWaiversView({ snapshot: l.snapshot, model, inputs: l.inputs, timeZone: "America/New_York", now: TEST_NOW.toISOString() });
  if (!v) throw new Error("no waivers view");
  return v;
}

/** The toggle's buttons: label, aria-pressed and classes. */
function toggle(html: string) {
  const group = /<div role="group" aria-label="Which weeks" class="([^"]*)">([\s\S]*?)<\/div>/.exec(html);
  const buttons = [...(group?.[2] ?? "").matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]*)">([^<]*)<\/button>/g)].map((m) => ({ pressed: m[1], classes: (m[2] ?? "").split(" "), label: m[3] }));
  return { classes: (group?.[1] ?? "").split(" "), buttons };
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("WaiverUpgradesCard", () => {
  const view = waiversView();
  const html = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view }));
  const text = textOf(html);

  it("is the section the header's 'Waivers' link goes to, titled 'Waiver upgrades', its heading focusable from script", () => {
    expect(html).toMatch(new RegExp(`^<section id="${WAIVERS_SECTION_ID}" class="[^"]*scroll-mt-4`));
    expect(text).toContain("Waiver upgrades");
    expect(text).toContain(view.intro);
    // The link and the arrival move focus to the first element focusable from script only (NavLink.revealSection): the heading.
    expect(html).toMatch(/^<section [^>]*><div [^>]*><div [^>]*><p [^>]*>Free agents<\/p><h2 tabindex="-1" class="[^"]*">Waiver upgrades<\/h2>/);
    expect(html.indexOf('tabindex="-1"')).toBe(html.indexOf("<h2") + "<h2 ".length);
  });

  it("a toggle of the two lists (rest of season pressed first), 44 px buttons in a labeled group", () => {
    const { buttons } = toggle(html);
    expect(buttons.map((b) => [b.label, b.pressed])).toEqual([
      ["Rest of season", "true"],
      ["This week", "false"],
    ]);
    for (const b of buttons) expect(b.classes).toContain("min-h-11");
  });

  it("while a week is under way, three lists: 'This week' (its games still to play) and 'Next week', wrapping on a narrow phone", () => {
    const { classes, buttons } = toggle(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: waiversView(true) })));
    expect(buttons.map((b) => [b.label, b.pressed])).toEqual([
      ["Rest of season", "true"],
      ["This week", "false"],
      ["Next week", "false"],
    ]);
    expect(classes).toEqual(expect.arrayContaining(["inline-flex", "flex-wrap", "max-w-full"]));
  });

  it("the first rows, then 'Show all' (44 px, aria-expanded)", () => {
    const ros = view.ros;
    expect(ros && ros.rows.length > ros.shown).toBe(true);
    const items = html.match(/<li class="rounded-xl border/g) ?? [];
    expect(items.length).toBe(ros?.shown);
    expect(html).toMatch(new RegExp(`<button type="button" aria-expanded="false" class="[^"]*min-h-11[^"]*">Show all ${ros?.rows.length}</button>`));
  });

  it("each card: name, position, team and bye, the points, whom he beats, the gain and the drop, tags in words", () => {
    const first = view.ros?.rows[0];
    if (!first) throw new Error("no row");
    expect(text).toContain(`${first.name} ${first.pos} · ${first.nflTeam} · ${first.bye}`);
    expect(text).toContain(`Points ${first.rosText} rest of season · Wk 4: ${first.weekText}`);
    expect(text).toContain(`Better than ${first.betterThan}`);
    expect(text).toContain(`Lineup gain: ${first.gain.text}`);
    expect(text).toContain(first.drop ?? "");
    // Oscar Hurt is out this week: his tag is a word.
    const hurt = view.ros?.rows.find((r) => r.name === "Oscar Hurt");
    expect(hurt?.injury?.long).toBe("Out");
    const depth = view.ros?.rows.slice(0, view.ros.shown).some((r) => r.depthOnly);
    if (depth) expect(text).toContain(DEPTH_ONLY_TAG);
  });

  it("fits 375 px: cards that wrap (no table), names and lists that break anywhere", () => {
    expect(html).not.toContain("<table");
    expect(html).toContain('class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"');
    expect(html).toContain('<p class="font-extrabold wrap-anywhere">');
    expect(html).toMatch(/<dd class="wrap-anywhere">/);
    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)]");
  });
});

describe("WaiverUpgrades on the League page", () => {
  it("renders nothing without the page's view (no provider, or nothing to show)", () => {
    expect(renderToStaticMarkup(createElement(WaiverUpgrades))).toBe("");
    expect(renderToStaticMarkup(createElement(WaiversViewContext, { value: null }, createElement(WaiverUpgrades)))).toBe("");
  });

  it("sits after the trade partners and before the streaming picks, from the League page's context", () => {
    const f = leagueFixture({});
    const leagueView = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
    const html = renderToStaticMarkup(createElement(WaiversViewContext, { value: waiversView() }, createElement(LeagueView, { view: leagueView })));
    const partners = html.indexOf("Best fits for your team");
    const waivers = html.indexOf(`<section id="${WAIVERS_SECTION_ID}"`);
    const streaming = html.indexOf("Streaming picks this week");
    expect(partners).toBeGreaterThan(0);
    expect(waivers).toBeGreaterThan(partners);
    expect(streaming).toBeGreaterThan(waivers);
  });
});
