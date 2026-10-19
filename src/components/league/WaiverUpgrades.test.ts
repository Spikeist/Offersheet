/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2; WaiverUpgrades.tsx), rendered statically (no
 * DOM, first render only), from a made-up league run through the engine: the section the header's link goes to
 * (id "waivers", its heading focusable from script so the link can move focus there: review of the Waivers link), the
 * toggle (44 px, aria-pressed; three lists while a week is under way, wrapping rather than overflowing), the first
 * config.waivers.rowsShown rows and "Show all", tags in words, the 375 px rules (cards that wrap, no table), and its place
 * on the League page (from the page's context, after the trade partners). Checkpoint 7f (planner reply to Checkpoint 7e,
 * item 3): the rows that help, then (its review, WAIVERS-1) the moves that can't be made, then the fold of the "No gain" rows
 * ("N more pickups that don't help you (show)": 44 px, aria-expanded, aria-controls only while its list is there, the list
 * right after it), or the line when none helps; the list's row count for check:browser (data-waiver-total, WAIVERS-3). The
 * focus rules after a recompute need a browser (WAIVERS-2: the fix's own write-up proves them in headless Chrome).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { buildLeagueModel, type LeagueModelConfig } from "@/engine/league";
import type { Pos } from "@/engine/model";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { TEST_NOW, buildTestLeague, type TestPlayer } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import { buildLeagueView } from "@/lib/leagueView";
import {
  DEPTH_ONLY_TAG,
  DEPTH_ONLY_WORDS,
  DETAILS_TEXT,
  ODDS_FRAME,
  ODDS_FRAME_SR,
  ODDS_LABEL,
  WHY_TEXT,
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

  it("the first rows that help, then 'Show all' (44 px, aria-expanded); every row helps here, so nothing is folded", () => {
    const ros = view.ros;
    expect(ros && ros.helping === ros.rows.length && ros.rows.length > ros.shown).toBe(true);
    const items = html.match(/<li class="rounded-xl border/g) ?? [];
    expect(items.length).toBe(ros?.shown);
    expect(html).toMatch(new RegExp(`<button type="button" aria-expanded="false" class="[^"]*min-h-11[^"]*">Show all ${ros?.rows.length}</button>`));
    expect(html).not.toContain("data-waiver-more");
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

  it("Checkpoint 7h: each card compact, its move, numbers and pills shown, the rest behind its own 44 px “Details” (aria-expanded, aria-controls naming a panel hidden until it opens)", () => {
    const first = view.ros?.rows[0];
    if (!first) throw new Error("no row");
    const item = /<li class="rounded-xl border[^"]*">([\s\S]*?)<\/li>/.exec(html)?.[1] ?? "";
    // The button: its words, the player for screen readers (and for focus across a redraw), closed, 44 px.
    const button = /<button type="button" aria-expanded="(true|false)" aria-controls="([^"]+)" data-waiver-details="([^"]+)" class="([^"]*)">([\s\S]*?)<\/button>/.exec(item);
    expect(button?.[1]).toBe("false");
    expect(button?.[3]).toBe(first.id);
    expect(button?.[4]?.split(" ")).toContain("min-h-11");
    expect(textOf(button?.[5] ?? "").trim()).toBe(`${DETAILS_TEXT} (${first.name}) ▾`);
    expect(button?.[5]).toMatch(/<span aria-hidden="true" class="[^"]*">▾<\/span>/);
    // The panel it names: always in the page, hidden until it opens, with Points and Better than; nothing of it before the button.
    const panel = new RegExp(`<div id="${button?.[2] ?? "?"}" hidden="" class="[^"]*">([\\s\\S]*)</div>$`).exec(item);
    expect(textOf(panel?.[1] ?? "")).toContain(`Points ${first.rosText} rest of season · Wk 4: ${first.weekText}`);
    expect(textOf(panel?.[1] ?? "")).toContain(`Better than ${first.betterThan}`);
    const before = item.slice(0, item.indexOf(button?.[0] ?? "?"));
    expect(textOf(before)).toContain(`Add ${first.name}`);
    expect(textOf(before)).toContain(`Lineup gain: ${first.gain.text}`);
    expect(before).not.toContain("Better than");
    expect(before).not.toContain("<dl");
  });

  it("Checkpoint 7h: the list's note is one line with a 44 px “Why?” at its end, the rest hidden until it opens (the toggle closes it again)", () => {
    const ros = view.ros;
    if (!ros) throw new Error("no list");
    expect(ros.lead).toBe("Lineup gain: what each move adds to your starting lineup over weeks 4–17.");
    const why = /<p>([^<]*)<button type="button" aria-expanded="(true|false)" aria-controls="([^"]+)" class="([^"]*)">([\s\S]*?)<\/button><\/p><p id="([^"]+)"( hidden="")?>([\s\S]*?)<\/p>/.exec(html);
    expect(textOf(why?.[1] ?? "").trim()).toBe(ros.lead);
    expect(why?.[2]).toBe("false");
    expect(why?.[3]).toBe(why?.[6]);
    expect(why?.[4]?.split(" ")).toContain("min-h-11");
    expect(textOf(why?.[5] ?? "").trim()).toBe(`${WHY_TEXT} (more on Rest of season's numbers)`);
    expect(why?.[7]).toBe(' hidden=""');
    expect(textOf(why?.[8] ?? "").trim()).toBe(ros.note);
    // Opened: the rest shows.
    const open = /aria-expanded="(true|false)" aria-controls="([^"]+)" class="[^"]*">Why\?[\s\S]*?<\/button><\/p><p id="[^"]+"( hidden="")?>/.exec(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view, open: { why: true } })));
    expect(open?.[1]).toBe("true");
    expect(open?.[3]).toBeUndefined();
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
  /** The section with the League page's settings, the rows that don't help unfolded (since the review of Checkpoint 7f a move that can't be made shows above the fold anyway). */
  const withEdit = (view: WaiversView, settings: TradeSettings) =>
    renderToStaticMarkup(createElement(LeagueSettingsEditContext, { value: { leagueKey: "test-key", settings, season: 2026 } }, createElement(WaiverUpgradesCard, { view, open: { more: true } })));

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

describe("Checkpoint 7f: the rows that don't help, folded (planner reply to Checkpoint 7e, item 3)", () => {
  /**
   * `helping` free-agent RBs who'd start in my FLEX (over Wade Route's 7), then `folded` who beat only Ronnie Slow (6): "No
   * gain", depth only. Unrated (no season simulated): the lineup gain is each row's main number.
   */
  function foldView(helping: number, folded: number, blocked = 0): WaiversView {
    const mine = MINE.map((x) => (x.id === "r3" ? { ...x, points: 6 } : x.id === "w3" ? { ...x, points: 7 } : x));
    const fas = [...Array.from({ length: helping + blocked }, (_, i) => p(`fh${i}`, "RB", 8 + i, `Helper Number${i}`)), ...Array.from({ length: folded }, (_, i) => p(`fd${i}`, "RB", 6.1 + i / 10, `Depth Number${i}`))];
    const l = buildTestLeague({ platform: "espn", teams: [{ id: "1", roster: mine }, { id: "2", roster: [p("q2", "QB", 18, "Other QB")] }], freeAgents: fas });
    const built = buildLeagueModel(l.snapshot, l.inputs, { now: TEST_NOW, sims: 0 }, NO_RISK);
    // `blocked` of the helpers made moves only untouchables could make room for (review of Checkpoint 7f, WAIVERS-1).
    const ros = built.waiverUpgrades?.ros;
    const cant = new Set(Array.from({ length: blocked }, (_, i) => `fh${i}`));
    const model =
      ros && blocked
        ? {
            ...built,
            waiverUpgrades: {
              ...(built.waiverUpgrades as NonNullable<typeof built.waiverUpgrades>),
              ros: { ...ros, rows: ros.rows.map((r) => (cant.has(r.playerId) ? { ...r, gain: null, drop: null, dropPoints: null, depthOnly: false, blocked: { why: "untouchable" as const, atPosition: true, otherPosition: true, untouchable: ["r2"] } } : r)) },
            },
          }
        : built;
    const v = buildWaiversView({ snapshot: l.snapshot, model, inputs: l.inputs, timeZone: "America/New_York", now: TEST_NOW.toISOString() });
    if (!v) throw new Error("no waivers view");
    return v;
  }
  const render = (view: WaiversView, open?: { all?: boolean; more?: boolean }) => renderToStaticMarkup(createElement(WaiverUpgradesCard, { view, ...(open ? { open } : {}) }));
  /** The fold's button: its attributes in the order React writes them, and its words. */
  const FOLD = /<button type="button" aria-expanded="(true|false)"(?: aria-controls="([^"]+)")? data-waiver-more="" class="([^"]*)">([^<]*)<\/button>/;
  const listOf = (html: string, which: "shown" | "rest") => new RegExp(`<ul(?: id="([^"]+)")? data-waiver-rows="${which}" aria-label="([^"]*)" class="[^"]*">([\\s\\S]*?)</ul>`).exec(html);
  const items = (html: string) => (html.match(/<li class="rounded-xl border/g) ?? []).length;

  it("the rows that help, then one button: “N more pickups that don't help you (show)”, 44 px, collapsed (aria-expanded false, no aria-controls); none of the others in the page", () => {
    const view = foldView(3, 2);
    expect([view.ros?.helping, view.ros?.blocked, view.ros?.rest?.count]).toEqual([3, 0, 2]);
    const html = render(view);
    // The list says how many rows it has, for check:browser (review of Checkpoint 7f, WAIVERS-3).
    expect(html).toMatch(/<div data-waiver-list="ros" data-rated="false" data-waiver-total="5">/);
    const helping = listOf(html, "shown");
    expect(textOf(helping?.[2] ?? "")).toBe("Waiver upgrades for the rest of the season");
    expect(items(helping?.[3] ?? "")).toBe(3);
    expect(items(html)).toBe(3);
    const fold = FOLD.exec(html);
    expect(fold?.[1]).toBe("false");
    expect(fold?.[2]).toBeUndefined();
    expect(fold?.[3]?.split(" ")).toEqual(expect.arrayContaining(["min-h-11", "max-w-full", "py-2", "text-left"]));
    expect(textOf(fold?.[4] ?? "")).toBe("2 more pickups that don't help you (show)");
    // Its own block after the rows (never beside "Show all"), and no folded list until it's opened.
    expect(html).toMatch(/<\/ul><div class="mt-3"><button type="button" aria-expanded="false" data-waiver-more=""/);
    expect(listOf(html, "rest")).toBeNull();
    expect(textOf(html)).not.toContain("No gain");
    expect(textOf(html)).not.toContain("Depth Number");
  });

  it("opened: the rows that don't help in their own list right after the button, “(hide)”, aria-expanded true and aria-controls naming that list", () => {
    const html = render(foldView(3, 2), { more: true });
    const fold = FOLD.exec(html);
    expect(fold?.[1]).toBe("true");
    expect(textOf(fold?.[4] ?? "")).toBe("2 more pickups that don't help you (hide)");
    const rest = listOf(html, "rest");
    expect(rest?.[1]).toBe(fold?.[2]);
    expect(textOf(rest?.[2] ?? "")).toBe("Pickups that don't help you over the rest of the season");
    expect(items(rest?.[3] ?? "")).toBe(2);
    expect(textOf(rest?.[3] ?? "")).toContain("Lineup gain: No gain");
    // Right after the button: the button stays where it was, so focus stays on it (the file header).
    expect(html).toMatch(/data-waiver-more="" class="[^"]*">[^<]*<\/button><\/div><ul id="[^"]+" data-waiver-rows="rest"/);
    expect(items(html)).toBe(5);
  });

  it("more than config.waivers.rowsShown help: the first of them and “Show all N”, N the rows that help, then the fold; “Show all” opened shows them all", () => {
    const view = foldView(config.waivers.rowsShown + 2, 2);
    const html = render(view);
    expect(items(listOf(html, "shown")?.[3] ?? "")).toBe(config.waivers.rowsShown);
    expect(html).toMatch(new RegExp(`<button type="button" aria-expanded="false" class="[^"]*min-h-11[^"]*">Show all ${config.waivers.rowsShown + 2}</button><div class="mt-3"><button type="button" aria-expanded="false" data-waiver-more=""`));
    const all = render(view, { all: true });
    expect(items(listOf(all, "shown")?.[3] ?? "")).toBe(config.waivers.rowsShown + 2);
    expect(all).toMatch(/aria-expanded="true" class="[^"]*">Show fewer<\/button>/);
    expect(listOf(all, "rest")).toBeNull();
  });

  it("none helps: the line instead of the rows, then the fold without “more”", () => {
    const html = render(foldView(0, 3));
    expect(html).toContain('<p data-waiver-none="" class="text-sm">No pickup helps you over the rest of the season.</p>');
    expect(listOf(html, "shown")).toBeNull();
    expect(textOf(FOLD.exec(html)?.[4] ?? "")).toBe("3 pickups that don't help you (show)");
    expect(items(html)).toBe(0);
    // Opened: the three rows.
    expect(items(render(foldView(0, 3), { more: true }))).toBe(3);
  });

  it("“This week” folds its own: the week in its words and its folded list's caption", () => {
    const view = foldView(2, 2);
    expect([view.week?.helping, view.week?.rest?.count]).toEqual([2, 2]);
    const html = render({ ...view, first: "week" }, { more: true });
    expect(html).toMatch(/<div data-waiver-list="week" data-rated="false" data-waiver-total="4">/);
    expect(textOf(FOLD.exec(html)?.[4] ?? "")).toBe("2 more pickups that don't help you this week (hide)");
    expect(textOf(listOf(html, "rest")?.[2] ?? "")).toBe("Pickups that don't help you in week 4");
  });

  it("moves that can't be made show above the fold, after the rows that help, with why; the fold counts the “No gain” rows alone (review of Checkpoint 7f, WAIVERS-1)", () => {
    const view = foldView(2, 2, 1);
    expect([view.ros?.helping, view.ros?.blocked, view.ros?.rest?.count]).toEqual([2, 1, 2]);
    const html = render(view);
    const shown = listOf(html, "shown");
    expect(items(shown?.[3] ?? "")).toBe(3);
    // The last row above the fold is the move that can't be made, its number and sentence in words, the switch's hint among them.
    const text = textOf(shown?.[3] ?? "");
    expect(text.lastIndexOf("Can't add")).toBeGreaterThan(text.lastIndexOf("Lineup gain: +"));
    expect(text).toContain(`Every RB you could drop is untouchable: R. Dash. ${SAME_POSITION_HINT}`);
    expect(textOf(FOLD.exec(html)?.[4] ?? "")).toBe("2 more pickups that don't help you (show)");
    expect(html).toMatch(/<div data-waiver-list="ros" data-rated="false" data-waiver-total="5">/);
    // Opened: the two "No gain" rows alone.
    const rest = listOf(render(view, { more: true }), "rest");
    expect(items(rest?.[3] ?? "")).toBe(2);
    expect(textOf(rest?.[3] ?? "")).not.toContain("Can't add");
  });

  it("none helps but a move can't be made: “No pickup you can make helps you …”, then that move, then the fold without “more”", () => {
    const html = render(foldView(0, 2, 1));
    expect(html).toContain('<p data-waiver-none="" class="text-sm">No pickup you can make helps you over the rest of the season.</p>');
    // The line first, then the list above the fold (spaced from it), holding the one move that can't be made.
    expect(html).toMatch(/No pickup you can make helps you over the rest of the season\.<\/p><ul data-waiver-rows="shown" aria-label="[^"]*" class="space-y-2 mt-3">/);
    expect(items(listOf(html, "shown")?.[3] ?? "")).toBe(1);
    expect(textOf(FOLD.exec(html)?.[4] ?? "")).toBe("2 pickups that don't help you (show)");
    // Every move can't be made: no fold at all.
    const only = render(foldView(0, 0, 2));
    expect(only).not.toContain("data-waiver-more");
    expect(items(listOf(only, "shown")?.[3] ?? "")).toBe(2);
  });

  it("“Show all N” counts the rows above the fold, the moves that can't be made among them", () => {
    const view = foldView(config.waivers.rowsShown - 1, 1, 3);
    const above = config.waivers.rowsShown + 2;
    expect((view.ros?.helping ?? 0) + (view.ros?.blocked ?? 0)).toBe(above);
    const html = render(view);
    expect(items(listOf(html, "shown")?.[3] ?? "")).toBe(config.waivers.rowsShown);
    expect(html).toContain(`>Show all ${above}</button>`);
    expect(items(listOf(render(view, { all: true }), "shown")?.[3] ?? "")).toBe(above);
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

describe("Checkpoint 7h: a rated row's odds lines in its details, and the week's opponent on a one-week list (planner reply to Checkpoint 7g, sections 1 and 5)", () => {
  // A made-up league with its season, its "Rest of season" rated as the League page rates it (400 seasons here).
  const RATED: LeagueModelConfig = { ...config, waivers: { ...config.waivers, ratingScreenSims: 100, ratingFinishRows: 2 } };
  const l = smallLeague(11);
  const model = buildLeagueModel(l.snapshot, l.inputs, { now: TEST_NOW, sims: 400, waiverRating: true }, RATED);
  const view = buildWaiversView({ snapshot: l.snapshot, model, inputs: l.inputs, timeZone: "America/New_York", now: TEST_NOW.toISOString() });
  if (!view?.ros?.rated) throw new Error("no rated list");
  const html = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view }));

  it("in the hidden panel, after the lineup gain: “Your odds: without a pickup → with this one” (the arrow in words for screen readers), then each line before → after", () => {
    const first = view.ros?.rows[0];
    if (!first?.odds) throw new Error("no odds");
    const item = /<li class="rounded-xl border[^"]*">([\s\S]*?)<\/li>/.exec(html)?.[1] ?? "";
    const panel = /<div id="[^"]+" hidden="" class="[^"]*">([\s\S]*)<\/div>$/.exec(item)?.[1] ?? "";
    // Their frame names the seasons behind them (the row's own: 400 when finished, 100 when screened only).
    expect([`${ODDS_FRAME} (from 400 simulated seasons)`, `${ODDS_FRAME} (from 100 simulated seasons)`]).toContain(first.odds.frame);
    expect(first.odds.srFrame).toBe(first.odds.frame.replace(ODDS_FRAME, ODDS_FRAME_SR));
    expect(panel).toContain(`<dt class="text-muted">${ODDS_LABEL}</dt><dd class="text-muted"><span aria-hidden="true">${first.odds.frame}</span><span class="sr-only">${first.odds.srFrame}</span></dd>`);
    for (const o of first.odds.lines) expect(panel).toContain(`<dt class="text-muted">${o.label}</dt><dd class="tabular-nums"><span aria-hidden="true">${o.value}</span><span class="sr-only">${o.srValue}</span></dd>`);
    // In order: the lineup gain, then the frame, then the lines.
    const at = (s: string) => textOf(panel).indexOf(s);
    expect(at("Lineup gain")).toBeGreaterThan(-1);
    expect(at(ODDS_LABEL)).toBeGreaterThan(at("Lineup gain"));
    expect(at("Title odds")).toBeGreaterThan(at(ODDS_LABEL));
    expect(at("Playoff odds")).toBeGreaterThan(at("Title odds"));
    // The odds show nowhere else: not before the button.
    expect(item.slice(0, item.indexOf("data-waiver-details"))).not.toContain("odds");
  });

  it("on a one-week list: the add line names the week's opponent where the season list names the bye, no odds lines", () => {
    const week = view.week;
    const r = week?.rows[0];
    if (!week || !r) throw new Error("no week list");
    expect(r.odds).toBeNull();
    const withOpponent: WaiversView = { ...view, first: "week", week: { ...week, rows: [{ ...r, opponent: { short: "@ YYY", long: "away at YYY" } }, ...week.rows.slice(1)] } };
    const out = renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: withOpponent }));
    expect(out).toContain(`<span class="text-xs font-semibold whitespace-nowrap text-muted">${r.pos} · ${r.nflTeam} · <span aria-hidden="true">@ YYY</span><span class="sr-only">away at YYY</span></span>`);
    // Without one (unknown), the bye as before.
    expect(renderToStaticMarkup(createElement(WaiverUpgradesCard, { view: { ...view, first: "week" } }))).toContain(`${r.pos} · ${r.nflTeam} · ${r.bye}</span>`);
    expect(out).not.toContain(ODDS_LABEL);
  });
});
