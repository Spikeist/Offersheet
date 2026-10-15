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
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { TEST_NOW, buildTestLeague, type TestPlayer } from "@/engine/testLeague";
import { buildLeagueView } from "@/lib/leagueView";
import {
  DEPTH_ONLY_TAG,
  DEPTH_ONLY_WORDS,
  RATING_PENDING_TEXT,
  RATING_PENDING_WEEK_TEXT,
  SAME_POSITION_HELP,
  SAME_POSITION_HINT,
  SAME_POSITION_LABEL,
  UNTOUCHABLES_LABEL,
  WAIVERS_INTRO,
  WAIVERS_NO_TEAM,
  WAIVERS_NO_WEEKS,
  WAIVERS_PICK_TEAM,
  WAIVERS_SECTION_ID,
  buildWaiversView,
  type WaiverRowView,
  type WaiversView,
} from "@/lib/waiversView";
import { LeagueView } from "./LeagueView";
import { LeagueSettingsEditContext } from "./leagueSettingsEdit";
import { LOCK_HELP } from "./UntouchableLock";
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
    expect(text).toContain(first.dropText ?? "");
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

describe("WaiverUpgradesCard without lists, and 'Depth only' in words (review of Phase 7b)", () => {
  it("no team picked: the section the header's link goes to, its heading, one line and a 44 px link to pick the team", () => {
    const html = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: { ros: null, underWay: null, week: null, first: "ros", intro: WAIVERS_INTRO, empty: WAIVERS_NO_TEAM, emptyLink: WAIVERS_PICK_TEAM } }));
    expect(html).toMatch(new RegExp(`^<section id="${WAIVERS_SECTION_ID}"`));
    expect(html).toContain('<h2 tabindex="-1"');
    const text = textOf(html);
    expect(text).toContain("Waiver upgrades");
    expect(text).toContain(WAIVERS_NO_TEAM);
    expect(html).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/import#your-team">Pick your team<\/a>/);
    expect(html).not.toContain('role="group"');
  });

  it("no week left: the line alone, no link", () => {
    const html = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: { ros: null, underWay: null, week: null, first: "ros", intro: WAIVERS_INTRO, empty: WAIVERS_NO_WEEKS, emptyLink: null } }));
    expect(textOf(html)).toContain(WAIVERS_NO_WEEKS);
    expect(html).not.toContain("<a ");
  });

  it("a 'Depth only' tag carries its list's words as hover text, and the list says them where every reader sees them", () => {
    const view = waiversView();
    const list = view.ros;
    if (!list) throw new Error("no list");
    const depthRow: WaiverRowView = { ...(list.rows[0] as WaiverRowView), id: "deep", depthOnly: true };
    const withDepth: WaiversView = { ...view, ros: { ...list, rows: [depthRow], note: `${list.note} ${DEPTH_ONLY_TAG}: ${DEPTH_ONLY_WORDS.ros}.` } };
    const html = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: withDepth }));
    expect(html).toContain(`<span title="${list.depthOnlyTitle.replace(/'/g, "&#x27;")}">`);
    expect(textOf(html)).toContain(`${DEPTH_ONLY_TAG}: ${DEPTH_ONLY_WORDS.ros}.`);
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

describe("Checkpoint 7e: one move per row, the switch and the locks (planner reply to Checkpoint 7d, items 3.1–3.3)", () => {
  /** MINE plus five bench players who never start: a full roster of 16 (every pickup drops someone); the league's settings as given. */
  const BENCH: TestPlayer[] = [p("b1", "RB", 1, "Benny One"), p("b2", "RB", 1.5, "Benny Two"), p("b3", "WR", 1, "Bert Three"), p("b4", "WR", 1.5, "Bert Four"), p("b5", "QB", 3, "Bo Five"), p("b6", "TE", 1, "Bud Six")];
  function fullView(settings: TradeSettings = defaultTradeSettings()): WaiversView {
    const fas = [p("fa1", "RB", 13, "Frankie Burst"), p("fa3", "WR", 12, "Fritz Wide")];
    const l = buildTestLeague({ platform: "espn", teams: [{ id: "1", roster: [...MINE, ...BENCH] }, { id: "2", roster: [p("q2", "QB", 18, "Other QB")] }], freeAgents: fas });
    const model = buildLeagueModel(l.snapshot, l.inputs, { now: TEST_NOW, sims: 0, settings }, NO_RISK);
    const v = buildWaiversView({ snapshot: l.snapshot, model, inputs: l.inputs, timeZone: "America/New_York", now: TEST_NOW.toISOString() });
    if (!v) throw new Error("no waivers view");
    return v;
  }
  const withEdit = (view: WaiversView, settings: TradeSettings) => renderToStaticMarkup(createElement(LeagueSettingsEditContext, { value: { leagueKey: "test-key", settings, season: 2026 } }, createElement(WaiverUpgradesCard, { view })));

  it("a row reads as one move: “Add” him, “Drop” the player named with his position, the two numbers on its right", () => {
    const view = fullView();
    const text = textOf(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view })));
    expect(text).toContain("Add Frankie Burst RB · AAA · bye unknown");
    expect(text).toContain("Drop B. One (RB)");
    const r = view.ros?.rows.find((x) => x.name === "Frankie Burst");
    expect(text).toContain(`Lineup gain: ${r?.main.text ?? "?"} ${r?.outscores ?? "?"}`);
  });

  it("with the League page's settings: the switch (role switch, its help linked), and a 44 px lock next to each drop", () => {
    const settings = defaultTradeSettings();
    const html = withEdit(fullView(settings), settings);
    // React writes checked="" last.
    const sw = /<input type="checkbox" role="switch" aria-describedby="([^"]+)" class="([^"]*)"( checked="")?\/>/.exec(html);
    expect(sw).not.toBeNull();
    expect(sw?.[3]).toBe(' checked=""');
    expect(html).toContain(`<p id="${sw?.[1] ?? "?"}" class="text-xs text-muted">${SAME_POSITION_HELP}</p>`);
    expect(html).toMatch(/<label class="[^"]*min-h-11[^"]*">[\s\S]*?Drop from the same position<\/label>/);
    expect(textOf(html)).toContain(SAME_POSITION_LABEL);
    // The lock next to the drop: what pressing it does, in words (never color alone), 44 px.
    // One name whichever way it's set, the state in aria-pressed, what pressing it does on hover (review of wave C, UI-C-10).
    expect(html).toMatch(/<button type="button" aria-pressed="false" aria-label="Untouchable: Benny One" title="Lock Benny One as untouchable" data-untouchable-lock="b1" class="[^"]*size-11[^"]*">/);
    // Off: the switch unchecked.
    const off = { ...settings, waiverSamePosition: false };
    expect(withEdit(fullView(off), off)).toMatch(/<input type="checkbox" role="switch" aria-describedby="[^"]+" class="[^"]*"\/>/);
  });

  it("my untouchables above the lists, each with a lock to unlock him; a move only they could make room for says so, with the switch's suggestion", () => {
    const settings = { ...defaultTradeSettings(), untouchables: ["w1", "w2", "w3", "b3", "b4"] };
    const view = fullView(settings);
    const html = withEdit(view, settings);
    const text = textOf(html);
    expect(text).toContain(`${UNTOUCHABLES_LABEL} W. Catch`);
    expect(html).toMatch(/aria-pressed="true" aria-label="Untouchable: Wes Catch" title="Wes Catch is untouchable. Unlock him" data-untouchable-lock="w1"/);
    // Fritz Wide (WR): every WR of mine who could go is untouchable (the trade's words: review of wave C, UI-C-4), named.
    expect(text).toContain(`Every WR you could drop is untouchable: W. Catch, W. Hands, W. Route, B. Three, B. Four. ${SAME_POSITION_HINT}`);
    expect(text).toContain("Lineup gain: Can't add");
    // Its number's hover says why, as the row does (UI-C-4), never "None of your players can make room".
    const fritz = view.ros?.rows.find((r) => r.name === "Fritz Wide");
    expect(fritz?.main.title).toBe(`Every WR you could drop is untouchable: W. Catch, W. Hands, W. Route, B. Three, B. Four. ${SAME_POSITION_HINT}`);
    // The locks to unlock them are on the untouchables line alone, never repeated on the row (review of wave C, UI-C-7).
    expect(html.match(/aria-pressed="true" aria-label="Untouchable: /g)).toHaveLength(5);
  });

  it("without the League page's settings (a test, another page): no switch and no locks", () => {
    const html = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: fullView() }));
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("untouchable");
  });

  it("say what the lock does where the locks are, and that untouchables stay out of trade ideas too (the final review of Checkpoint 7e, UI-F-3)", () => {
    const settings = { ...defaultTradeSettings(), untouchables: ["w1"] };
    const text = textOf(withEdit(fullView(settings), settings));
    expect(text).toContain(LOCK_HELP);
    expect(UNTOUCHABLES_LABEL).toBe("Untouchable (never in trade ideas, never suggested as drops):");
    expect(text).toContain(`${UNTOUCHABLES_LABEL} W. Catch`);
    // No locks without the League page's settings: no words either.
    expect(textOf(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: fullView() })))).not.toContain(LOCK_HELP);
  });
});

describe("the season list's rating under way, on every list (the final review of Checkpoint 7e, UI-F-7)", () => {
  it("“Rest of season” says it's being rated; a one-week list that its drops can change, its note that a drop is the season list's when he's on it", () => {
    const view = waiversView();
    const statusOf = (html: string) => /<p role="status" class="[^"]*">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? null;
    expect(textOf(statusOf(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view, rating: "pending" }))) ?? "").trim()).toBe(RATING_PENDING_TEXT);
    const week: WaiversView = { ...view, first: "week" };
    expect(textOf(statusOf(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: week, rating: "pending" }))) ?? "").trim()).toBe(RATING_PENDING_WEEK_TEXT);
    // Mounted with nothing in it otherwise, so the change is announced.
    expect(statusOf(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: week })))).toBe("");
    expect(view.week?.note).toContain("after dropping the player named (the same one as for the rest of the season when he's on that list).");
  });
});
