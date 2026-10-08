/**
 * The Settings page (CLAUDE.md §14 item 6; lead decision L12), rendered statically (first render only) with the
 * league store's state mocked (Phase 4c: src/lib/leagueStore.ts, leagueStoreStateOf: the league this tab shows, its
 * "my team" pick, its settings and every league's feedback): without a league it says settings need one (and the
 * feedback card is still there), a league saved by an earlier version asks for the league again, and with a league
 * every setting is a labeled native control in a fieldset, checked as saved. A small made-up league; every name is
 * invented.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { applyFeedback, type FeedbackRecord } from "@/lib/feedbackStore";
import { IMPORT_FORMAT_VERSION, OUTDATED_IMPORT_TITLE, type StoredImport } from "@/lib/importStore";
import { leagueStoreStateOf, savedLeagueId, type LeagueStoreState } from "@/lib/leagueStore";
import { modelKey, type StoredModel } from "@/lib/modelStore";
import { leagueKey } from "@/lib/settingsStore";
import {
  FEEDBACK_SCOPE_TEXT,
  FeedbackCardView,
  SHARE_LABEL,
  SHARE_TEXT,
  deleteQuestionText,
  deleteStep,
  feedbackCountText,
  type DeleteFocus,
  type DeleteStep,
  type FeedbackCardViewProps,
  type FeedbackNote,
} from "./FeedbackCard";
import { SaveStatus, SettingsForm, focusAfterRemoval } from "./SettingsForm";
import { NO_LEAGUE_TITLE, OUTDATED_TEXT, SettingsPage } from "./SettingsPage";
import { buildSettingsView } from "./settingsView";
import { snapshot } from "./testFixtures";

/** The league store's state the page sees: null = the real hook's (the server's: loading). */
const env = vi.hoisted(() => ({ state: null as LeagueStoreState | null }));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, useLeagueStoreState: () => env.state ?? actual.useLeagueStoreState() };
});

const snap = snapshot();
const stored: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: "2026-09-30T20:00:00.000Z", request: { platform: "espn", season: 2026, leagueId: snap.leagueId }, response: { snapshot: snap, notes: [] } };

/**
 * The page with: `league` (a saved league in this version's format, one saved by an earlier version, or none), "my
 * team", its settings and feedback; `loading`: the store not read yet (the server's render and hydration).
 */
function render(opts: { league?: "current" | "outdated"; importValue?: StoredImport; myTeam?: string; settings?: TradeSettings; feedback?: FeedbackRecord[]; loading?: boolean } = {}): string {
  const imported = opts.importValue ?? stored;
  const id = savedLeagueId(imported.response.snapshot);
  const base = leagueStoreStateOf({
    imports: opts.league ? [imported] : [],
    ...(opts.myTeam ? { picks: { [id]: { teamId: opts.myTeam, source: "you" as const } } } : {}),
    ...(opts.settings ? { settings: { [leagueKey(snap)]: opts.settings } } : {}),
    ...(opts.feedback ? { feedback: opts.feedback } : {}),
  });
  env.state = opts.loading ? null : opts.league === "outdated" ? { ...base, imports: new Map([[id, { kind: "outdated", request: imported.request }]]) } : base;
  return renderToStaticMarkup(createElement(SettingsPage));
}

/** Visible text, tags and the entities React writes removed. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The checked radio's value in a group (React writes attributes in its own order). */
function radioChecked(html: string, name: string): string[] {
  return [...html.matchAll(/<input type="radio"([^>]*)\/>/g)]
    .map(([, attrs = ""]) => attrs)
    .filter((attrs) => attrs.includes(`name="${name}"`) && /checked=""/.test(attrs))
    .map((attrs) => /value="([^"]*)"/.exec(attrs)?.[1] ?? "");
}

/** Every checkbox: its label text and whether it's checked. */
function checkboxes(html: string): [string, boolean][] {
  return [...html.matchAll(/<label[^>]*><input type="checkbox"([^>]*)\/>(.*?)<\/label>/g)].map(([, attrs = "", inner = ""]) => [textOf(inner), /checked=""/.test(attrs)]);
}

afterEach(() => {
  env.state = null;
});

describe("without a league it can read", () => {
  it("says settings are saved per league and links to Connect, and still offers the feedback card", () => {
    const html = render();
    const text = textOf(html);
    expect(html).toContain('<h1 class="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>');
    expect(text).toContain(NO_LEAGUE_TITLE);
    expect(html).toMatch(/<a class="[^"]*" href="\/connect">Connect your league<\/a>/);
    expect(text).toContain("Your trade feedback");
    expect(text).toContain("Nothing saved yet.");
    expect(html).toMatch(/<button type="button" disabled="" class="[^"]*">Export feedback<\/button>/);
    expect(text).not.toContain("Delete saved feedback");
  });

  it("asks for the league again when it was saved by an earlier version of Offer Sheet, with Import again as on the other pages", () => {
    const html = render({ league: "outdated" });
    const text = textOf(html);
    expect(text).toContain(OUTDATED_IMPORT_TITLE);
    expect(text).toContain(OUTDATED_TEXT);
    expect(text).not.toContain(NO_LEAGUE_TITLE);
    // Phase 4c's import format makes a Phase 4b import one of these (review of track ML): one click brings it back.
    expect(html).toMatch(/<button type="button" class="[^"]*">Import again<\/button>/);
    expect(html).toMatch(/<a class="[^"]*" href="\/connect">Connect your league<\/a>/);
    // Without a league id to send: the Connect page.
    const noId = textOf(render({ league: "outdated", importValue: { ...stored, request: { platform: "sleeper", season: 2026, username: "zorblax_q" } } }));
    expect(noId).not.toContain("Import again");
    expect(noId).toContain("Connect your league");
  });

  it("has one page heading: the cards' headings are h2", () => {
    expect(render().match(/<h1[ >]/g)).toHaveLength(1);
  });
});

describe("with a league", () => {
  it("waits for the league store before showing settings (server render and hydration)", () => {
    const text = textOf(render({ league: "current", myTeam: "1", loading: true }));
    expect(text).toContain("Loading your league…");
    expect(text).not.toContain("Positions I stream weekly");
    expect(text).toContain("Checking this browser…");
  });

  it("shows every setting as a labeled group, with the defaults checked when nothing is saved", () => {
    const html = render({ league: "current", myTeam: "1" });
    expect(radioChecked(html, "max-per-side")).toEqual(["2"]);
    expect(radioChecked(html, "protect-value")).toEqual(["medium"]);
    expect(radioChecked(html, "goal")).toEqual(["title"]);
    const legends = [...html.matchAll(/<legend[^>]*>(.*?)<\/legend>/g)].map((m) => textOf(m[1] ?? ""));
    expect(legends).toEqual([
      "Positions I stream weekly",
      "What does your league reward?",
      "Protect my trade value",
      "Most players per side",
      "Also include",
      "Untouchables",
      "Must include",
      "Only get these positions",
      "Never get these positions",
    ]);
    const boxes = checkboxes(html);
    expect(boxes.slice(0, 4)).toEqual([
      ["Kicker (K)", true],
      ["D/ST", true],
      ["Quarterback (QB)", false],
      ["Tight end (TE)", false],
    ]);
    expect(boxes).toContainEqual(["Include kickers and D/STs in trade ideas", false]);
    expect(textOf(html)).toContain("This league uses the defaults.");
    expect(textOf(html)).not.toContain("Reset to defaults");
    // The playoff weight is read-only (planner reply to Checkpoint 7a, §6.1): without fresh saved inputs, the League page sets it.
    expect(radioChecked(html, "playoff-weight")).toEqual([]);
    expect(textOf(html)).toContain(
      "Playoff weeks count: set automatically from your odds when the League page loads. It only affects shortlists, free-agent rankings (and so the pickups your odds count), needs and trade chips.",
    );
    // Win now ↔ Future and draft picks are for dynasty and keeper leagues only, and so is the line saying the slider covers
    // trade value there (planner reply to Checkpoint 7b, Q3).
    expect(textOf(html)).not.toContain("Win now");
    expect(textOf(html)).not.toContain("Include draft picks");
    expect(textOf(html)).not.toContain("covers trade value");
  });

  it("checks what's saved, and offers Reset to defaults", () => {
    const settings: TradeSettings = { ...defaultTradeSettings(), streamPositions: ["DEF", "TE"], maxPerSide: 3, untouchables: ["103"], mustInclude: ["202"], avoidPositions: ["TE"], protectValue: "high" };
    const html = render({ league: "current", myTeam: "1", settings });
    const boxes = checkboxes(html);
    expect(boxes.slice(0, 4).map(([, c]) => c)).toEqual([false, true, false, true]);
    expect(boxes).toContainEqual(["Cal Catcher WR · SEA", true]);
    expect(boxes).toContainEqual(["Abe Runner RB · DAL", false]);
    expect(radioChecked(html, "max-per-side")).toEqual(["3"]);
    expect(radioChecked(html, "protect-value")).toEqual(["high"]);
    expect(textOf(html)).toContain("Rex Rusher · RB · DET Team Two");
    expect(radioChecked(render({ league: "current", myTeam: "1", settings: { ...settings, goal: "playoffs" } }), "goal")).toEqual(["playoffs"]);
    expect(html).toMatch(/<button type="button" class="[^"]*">Remove<span class="sr-only"> Rex Rusher<\/span><\/button>/);
    expect(textOf(html)).toContain("These are your settings for this league");
    expect(html).toMatch(/<button type="button" class="[^"]*">Reset to defaults<\/button>/);
    // The Trade Finder's minimum is at its default here: not mentioned.
    expect(textOf(html)).not.toContain("Chance they accept: at least");
  });

  it("names the Trade Finder's minimum chance in the league's card when it's what makes the settings saved, and what Reset does to it (final review of Phase 4c, finding PAGES-5)", () => {
    const html = render({ league: "current", myTeam: "1", settings: { ...defaultTradeSettings(), minChance: 0.3 } });
    expect(textOf(html)).toContain("These are your settings for this league, saved in this browser. The League page and trade ideas use them. The Trade Finder's “Chance they accept: at least” is 30%, set on the Trade Finder. Reset to defaults sets it back to 10% too.");
    expect(html).toMatch(/<button type="button" class="[^"]*">Reset to defaults<\/button>/);
  });

  it("links each group's help text to its fieldset, and gives every control a 44 px target", () => {
    const html = render({ league: "current", myTeam: "1" });
    for (const [, id] of html.matchAll(/<fieldset aria-describedby="([^"]+)"/g)) expect(html).toContain(`<p id="${id}" class=`);
    expect(html.match(/<fieldset aria-describedby=/g)?.length).toBeGreaterThanOrEqual(6);
    for (const [label] of html.matchAll(/<label class="[^"]*"><input type="(?:checkbox|radio)"/g)) expect(label).toContain("min-h-11");
    // The must-include picker: a labeled select grouped by team (mine first), with an Add button.
    expect(html).toMatch(/<label for="([^"]+)" class="sr-only">Player to include<\/label><select id="\1"/);
    expect([...html.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1])).toEqual(["Your team", "Team Two", "Team Three"]);
  });

  it("points to the Import Report when it doesn't know which team is mine", () => {
    const html = render({ league: "current" });
    expect(textOf(html)).toContain("Pick your team on the Import Report first");
    expect(html).toContain('href="/import#your-team"');
    expect(html).not.toMatch(/<legend[^>]*>Untouchables<\/legend>/);
    expect(html).not.toMatch(/<legend[^>]*>Must include<\/legend>/);
  });

  it("shows Win now ↔ Future and draft picks in a dynasty league", () => {
    const dynasty = { ...stored, response: { ...stored.response, snapshot: snapshot({ leagueType: "dynasty" }) } };
    const html = render({ league: "current", importValue: dynasty, myTeam: "1", settings: { ...defaultTradeSettings(), lambda: 0.25 } });
    const text = textOf(html);
    expect(text).toContain("Win now or build for the future");
    expect(text).toContain("Mostly this season: later seasons count 25%");
    expect(text).toContain("Include draft picks");
    // "Protect my trade value" is for redraft leagues: long-term value counts here instead, and the page says so after the
    // slider, before the next card (planner reply to Checkpoint 7b, Q3).
    expect(text).not.toContain("Protect my trade value");
    expect(html).not.toContain('name="protect-value"');
    const note = "In dynasty and keeper leagues, the Win now ↔ Future slider covers trade value.";
    expect(html).toContain(`<p class="text-sm leading-relaxed text-muted">${note}</p>`);
    expect(text.indexOf("Win now or build for the future")).toBeLessThan(text.indexOf(note));
    expect(text.indexOf(note)).toBeLessThan(text.indexOf("Most players per side"));
    // A keeper league too.
    const keeper = { ...stored, response: { ...stored.response, snapshot: snapshot({ leagueType: "keeper" }) } };
    expect(textOf(render({ league: "current", importValue: keeper, myTeam: "1" }))).toContain(note);
    // The slider is labeled and reads its value out in words; the same words show under it, hidden from screen readers.
    expect(html).toMatch(/<label for="([^"]+)" class="sr-only">How much later seasons count<\/label><input id="\1" type="range" min="0" max="1" step="0.05" aria-valuetext="Mostly this season: later seasons count 25%"[^>]*value="0.25"/);
    expect(html).toContain('<p class="mt-1 text-sm font-semibold" aria-hidden="true">Mostly this season: later seasons count 25%</p>');
  });

  it("offers 'What does your league reward?' as three labeled radios, each with its line of help linked as a description, in every league type (planner reply to Checkpoint 4b, change 8; 7a, 5.2)", () => {
    const html = render({ league: "current", myTeam: "1" });
    // One label at a time (never across into the next one).
    const rows = [...html.matchAll(/<label class="([^"]*)"><input type="radio"([^>]*)\/>((?:(?!<label).)*?)<\/label><p id="([^"]+)"[^>]*>(.*?)<\/p>/g)]
      .filter(([, , attrs = ""]) => attrs.includes('name="goal"'))
      .map(([, cls = "", attrs = "", name = "", id = "", help = ""]) => ({ cls, described: attrs.includes(`aria-describedby="${id}"`), name: textOf(name), help: textOf(help) }));
    expect(rows.map((r) => [r.name, r.help])).toEqual([
      ["Only the champion default", "Weighs your title odds most (85%), playoff odds 15%."],
      ["Several prizes", "Weighs your share of the league's prizes most (85%), playoff odds 15%."],
      ["Making the playoffs", "Weighs your playoff odds most (70%), title odds 30%."],
    ]);
    // The planner's helper line with the group's help (no auto-switching by odds).
    expect(textOf(html)).toContain("On the bubble? Keep “Only the champion.” It already counts getting into the playoffs.");
    for (const r of rows) {
      expect(r.described).toBe(true);
      expect(r.cls).toContain("min-h-11");
    }
    // A real space between the label and "default" (final review of Phase 4c, finding PAGES-4: the accessible name read
    // "Win the titledefault", the two spans side by side with only a margin between them).
    expect(html).toMatch(/>Only the champion<\/span> <span class="[^"]*">default<\/span>/);
    expect(html).not.toContain("Only the champion</span><span");
    expect(textOf(html)).toContain("Scoring How trade ideas are scored");
    const dynasty = { ...stored, response: { ...stored.response, snapshot: snapshot({ leagueType: "dynasty" }) } };
    const dyn = render({ league: "current", importValue: dynasty, myTeam: "1" });
    expect(radioChecked(dyn, "goal")).toEqual(["title"]);
    // The lead's words for Checkpoint 7c, the same whichever answer is chosen.
    expect(textOf(dyn)).toContain("For this season, Helps you scores a trade by how much it raises your chances at what your league pays and of making the playoffs");
  });

  it("under “Several prizes”, shows the league's prizes as a group of their own: five labeled 44 px fields, the planner's helper line as its description, and the split (planner reply to Checkpoint 7b, §6)", () => {
    const html = render({ league: "current", myTeam: "1", settings: { ...defaultTradeSettings(), goal: "prizes" } });
    expect(radioChecked(html, "goal")).toEqual(["prizes"]);
    // A sibling group right after the goal's, so the goal's group keeps its three labeled choices (check:browser counts them).
    const legends = [...html.matchAll(/<legend[^>]*>(.*?)<\/legend>/g)].map((m) => textOf(m[1] ?? ""));
    expect(legends.slice(1, 4)).toEqual(["What does your league reward?", "Your league's prizes", "Protect my trade value"]);
    const goalGroup = /<fieldset[^>]*><legend[^>]*>What does your league reward\?<\/legend>([^]*?)<\/fieldset>/.exec(html)?.[1] ?? "";
    expect(goalGroup.match(/<label[ >]/g)).toHaveLength(3);
    // The group's help is the planner's line, linked as the fieldset's description.
    const group = /<fieldset aria-describedby="([^"]+)"><legend[^>]*>Your league&#x27;s prizes<\/legend><p id="\1"[^>]*>([^<]*)<\/p>([^]*?)<\/fieldset>/.exec(html);
    expect(group).not.toBeNull();
    expect(textOf(group?.[2] ?? "")).toBe("Enter each prize in dollars or percent, the same way for all. Only the split matters. Leave blank what your league doesn't pay.");
    // Each field: a visible label tied to its input, a decimal keyboard on phones, 44 px (inputClass), prefilled 60 / 30 / 10.
    const fields = [...(group?.[3] ?? "").matchAll(/<label for="([^"]+)"[^>]*>([^<]*)<\/label><div[^>]*><input id="\1"([^>]*)\/>/g)].map(([, , label = "", attrs = ""]) => ({
      label,
      value: /value="([^"]*)"/.exec(attrs)?.[1] ?? null,
      decimal: /inputmode="decimal"/i.test(attrs),
      tall: /class="[^"]*min-h-11/.test(attrs),
      invalid: /aria-invalid/.test(attrs),
    }));
    expect(fields).toEqual(
      [
        ["1st place", "60"],
        ["2nd place", "30"],
        ["3rd place", "10"],
        ["High score, each regular-season week", ""],
        ["Most points in the regular season", ""],
      ].map(([label, value]) => ({ label, value, decimal: true, tall: true, invalid: false })),
    );
    // Each field's message about text it can't read goes in a polite live region that's already there, empty, so it's
    // announced when it shows on blur, after focus has left the field (review of the prizes UI, prizes-ui-3).
    expect((group?.[3] ?? "").match(/<div aria-live="polite"><\/div>/g)).toHaveLength(5);
    expect(textOf(group?.[3] ?? "")).toContain("Your prizes split: 1st 60%, 2nd 30%, 3rd 10%.");
    // Nothing entered: a warning instead of the split.
    const empty = textOf(render({ league: "current", myTeam: "1", settings: { ...defaultTradeSettings(), goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null } } }));
    expect(empty).toContain("Enter at least one prize. Until then, Helps you counts the title only.");
    expect(empty).not.toContain("Your prizes split");
    // Not under the other two answers.
    for (const goal of ["title", "playoffs"] as const) expect(render({ league: "current", myTeam: "1", settings: { ...defaultTradeSettings(), goal } })).not.toContain("Your league&#x27;s prizes");
  });

  it("says Protect my trade value changes nothing while the league's latest inputs value players by our own estimates, and only then (planner reply to Checkpoint 4b, change 12)", () => {
    const id = savedLeagueId(snap);
    const model = (fallback: { kind: "saved" | "curve"; listDate: string } | null, builtAt: string): StoredModel => ({
      version: 1,
      savedAt: builtAt,
      key: modelKey(snap),
      snapshotFetchedAt: snap.fetchedAt,
      model: {
        version: 1,
        season: 2026,
        currentWeek: 4,
        lastWeek: 17,
        builtAt,
        nfl: { byeWeek: {}, kickoffs: {} },
        players: {},
        espnProjections: true,
        market: { values: {}, knownIds: [], topValue: 10000, fetchedAt: builtAt, format: { isDynasty: false, numQbs: 1, numTeams: 8, ppr: 1, substitutions: [] }, ...(fallback ? { fallback } : {}) },
        sources: [],
        warnings: [],
        notes: [],
      },
    });
    const withModel = (m: StoredModel) => {
      const base = leagueStoreStateOf({ imports: [stored], picks: { [id]: { teamId: "1", source: "you" as const } }, models: { [id]: m } });
      env.state = base;
      return textOf(renderToStaticMarkup(createElement(SettingsPage)));
    };
    const now = new Date().toISOString();
    const note = "For now this setting changes nothing: FantasyCalc isn't available, so this league's trade values are our own estimates";
    expect(withModel(model({ kind: "curve", listDate: "2026-09-01T00:00:00.000Z" }, now))).toContain(note);
    // A saved list standing in is FantasyCalc's own: nothing to say.
    expect(withModel(model({ kind: "saved", listDate: "2026-09-28T00:00:00.000Z" }, now))).not.toContain(note);
    expect(withModel(model(null, now))).not.toContain(note);
    // Inputs too old for the League page to reuse don't say what the values are now: nothing either.
    expect(withModel(model({ kind: "curve", listDate: "2026-09-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z"))).not.toContain(note);
  });

  it("works the playoff weight out from the league's fresh saved inputs, and says so while it does (planner reply to Checkpoint 7a, §6.1)", () => {
    const id = savedLeagueId(snap);
    const withInputs = (builtAt: string) => {
      const m: StoredModel = {
        version: 1,
        savedAt: builtAt,
        key: modelKey(snap),
        snapshotFetchedAt: snap.fetchedAt,
        model: { version: 1, season: 2026, currentWeek: 4, lastWeek: 17, builtAt, nfl: { byeWeek: {}, kickoffs: {} }, players: {}, espnProjections: true, market: null, sources: [], warnings: [], notes: [] },
      };
      env.state = leagueStoreStateOf({ imports: [stored], picks: { [id]: { teamId: "1", source: "you" as const } }, models: { [id]: m } });
      return textOf(renderToStaticMarkup(createElement(SettingsPage)));
    };
    // The first render: the page's own engine worker starts after it, so the weight is still being worked out.
    expect(withInputs(new Date().toISOString())).toContain("Playoff weeks count: set automatically from your odds. Working it out…");
    // Inputs too old for the League page to reuse: the League page sets it when it loads.
    expect(withInputs("2026-01-01T00:00:00.000Z")).toContain("Playoff weeks count: set automatically from your odds when the League page loads.");
  });

  it("links a checkbox's longer help to it as a description, not as part of its name", () => {
    const dynasty = { ...stored, response: { ...stored.response, snapshot: snapshot({ leagueType: "dynasty" }) } };
    const html = render({ league: "current", importValue: dynasty, myTeam: "1" });
    const described = [...html.matchAll(/<input type="checkbox"[^>]*aria-describedby="([^"]+)"[^>]*\/>(.*?)<\/label><p id="\1"[^>]*>(.*?)<\/p>/g)].map(([, , name = "", help = ""]) => [textOf(name), textOf(help).slice(0, 30)]);
    expect(described).toEqual([
      ["Automatic", "Set from your playoff odds: la"],
      ["Include kickers and D/STs in trade ideas", "Off by default: managers rarel"],
      ["Include draft picks", "Draft picks aren't part of tra"],
      // Phase 7a (track FB): the feedback card's sharing choice, the same way.
      ["Share anonymous feedback", "When it's on, each press also "],
    ]);
  });
});

describe("the feedback card", () => {
  const records = ["a", "b"].reduce<FeedbackRecord[]>(
    (list, key) =>
      applyFeedback(list, {
        leagueKey: leagueKey(snap),
        evaluation: {
          key,
          proposal: { partnerId: "2", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "201" }] },
          features: { g: 0, n: 0, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: -0.6 },
          b: 3,
          tradeScore: 39,
          pAccept: 0.35,
          pComplete: 0.35,
          overall: 16,
          dPO: 0.03,
          dCH: 0.01,
          dPPW: 1.5,
          gMine: 0,
          gPartner: 0,
        },
        change: { outcome: "sent" },
        at: "2026-10-01T18:00:00.000Z",
      }),
    [],
  );

  it("counts the saved feedback and enables Export and Delete", () => {
    const html = render({ feedback: records });
    expect(textOf(html)).toContain("2 trade ideas with feedback saved in this browser.");
    expect(html).toMatch(/<button type="button" class="[^"]*">Export feedback<\/button>/);
    expect(html).toMatch(/<button type="button" class="[^"]*">Delete saved feedback<\/button>/);
    expect(feedbackCountText(undefined)).toBe("Checking this browser…");
    expect(feedbackCountText(1)).toBe("1 trade idea with feedback saved in this browser.");
  });

  it("offers 'Share anonymous feedback' (Phase 7a, track FB): on by default, with what a copy holds and never holds, and the privacy policy's link", () => {
    for (const html of [render(), render({ league: "current", myTeam: "1", feedback: records })]) {
      const text = textOf(html);
      expect(html).toMatch(/<label class="[^"]*min-h-11[^"]*"><input type="checkbox"[^>]*checked=""[^>]*\/><span>Share anonymous feedback<\/span><\/label>/);
      expect(checkboxes(html)).toContainEqual(["Share anonymous feedback", true]);
      expect(text).toContain(SHARE_TEXT);
      expect(text).toContain("never your league's ID, names, usernames or the notes you type");
      // It lists what's sent, not "exactly" (review POL-9: the policy summarizes some fields with "such as").
      expect(text).toContain("The privacy policy lists what's sent.");
      expect(text).not.toContain("lists exactly");
      expect(SHARE_TEXT).toContain("an anonymous copy, to help improve it:");
      expect(html).toMatch(/<a class="[^"]*" href="\/privacy">privacy policy<\/a>/);
      // The card no longer says nothing is sent.
      expect(text).not.toContain("Nothing is sent anywhere");
      expect(text).toContain("Offer Sheet keeps that in this browser, with the trade's numbers, so you can export it.");
    }
    const view = (sharing: FeedbackCardViewProps["sharing"]) => renderToStaticMarkup(createElement(FeedbackCardView, { count: 0, confirming: false, note: null, onExport: () => {}, onAsk: () => {}, onKeep: () => {}, onDelete: () => {}, sharing }));
    // Off: unchecked. A choice the browser wouldn't keep: an alert under it.
    const off = view({ on: false, onChange: () => {}, error: "Your browser wouldn't let Offer Sheet save this choice." });
    expect(checkboxes(off)).toEqual([["Share anonymous feedback", false]]);
    expect(off).toMatch(/role="alert"[^>]*>.*Your browser wouldn&#x27;t let Offer Sheet save this choice\./);
    // Without `sharing` (tests of the card's other parts), no checkbox.
    expect(view(undefined)).not.toContain(SHARE_LABEL);
  });

  it("says it covers every league's feedback, and how many leagues when there are several, since Delete takes them all (review of track ML)", () => {
    // Feedback from another league too: the page edits this league, the card covers both.
    const other = records.map((r) => ({ ...r, leagueKey: "sleeper:12345678", tradeKey: `other-${r.tradeKey}` }));
    const text = textOf(render({ league: "current", feedback: [...records, ...other] }));
    expect(text).toContain(FEEDBACK_SCOPE_TEXT);
    expect(text).toContain("4 trade ideas with feedback saved in this browser, across 2 leagues.");
    expect(feedbackCountText(5, 3)).toBe("5 trade ideas with feedback saved in this browser, across 3 leagues.");
    // Review FB-R3: Delete doesn't take back the anonymous copies already sent, and says so.
    expect(deleteQuestionText(2)).toBe("Delete the feedback on 2 trade ideas? You can't undo this. Anonymous copies already sent aren't affected.");
    expect(deleteQuestionText(4, 2)).toBe("Delete the feedback on 4 trade ideas in both leagues? You can't undo this. Anonymous copies already sent aren't affected.");
    expect(deleteQuestionText(5, 3)).toBe("Delete the feedback on 5 trade ideas in all 3 leagues? You can't undo this. Anonymous copies already sent aren't affected.");
    const asking = renderToStaticMarkup(createElement(FeedbackCardView, { count: 4, leagues: 2, confirming: true, note: null, onExport: () => {}, onAsk: () => {}, onKeep: () => {}, onDelete: () => {} }));
    expect(textOf(asking)).toContain("Delete the feedback on 4 trade ideas in both leagues? You can't undo this. Anonymous copies already sent aren't affected.");
  });

  it("says what the exported file holds: ID numbers, numbers and notes, no names, leagues only numbered (review)", () => {
    const text = textOf(render({ feedback: records }));
    expect(text).toContain("The file holds player and team ID numbers and Offer Sheet's numbers for each trade, plus any notes you typed and the random code each one's anonymous copies carry.");
    // Notes are kept as typed, so they can hold names (review POL-24).
    expect(text).toContain("Apart from what your notes say, it has no names, and it numbers your leagues (league-1, league-2) rather than saying which they are.");
  });

  describe("keyboard focus through Delete: each step takes away the button pressed, so focus moves to what took its place (review)", () => {
    const noop = () => {};
    const view = (state: { count: number; confirming: boolean; note: FeedbackNote | null }) =>
      renderToStaticMarkup(createElement(FeedbackCardView, { ...state, onExport: noop, onAsk: noop, onKeep: noop, onDelete: noop }));
    const deleteButton = /<button type="button" class="[^"]*">Delete saved feedback<\/button>/;
    /** Whether the element focus goes to is on the card, and can take focus. */
    function hasTarget(html: string, focus: DeleteFocus): boolean {
      if (focus === "delete") return deleteButton.test(html);
      if (focus === "status") return /<p role="status" tabindex="-1" class="[^"]*">Deleted\. No feedback is saved in this browser now\.<\/p>/.test(html);
      const question = /<p id="([^"]+)" tabindex="-1" class="[^"]*">Delete the feedback on 2 trade ideas\? You can&#x27;t undo this\. Anonymous copies already sent aren&#x27;t affected\.<\/p>/.exec(html);
      // The confirmation is a group named by its question.
      return !!question && html.includes(`<div role="group" aria-labelledby="${question[1]}"`);
    }
    const after: Record<DeleteStep, { count: number; note: FeedbackNote | null }> = {
      ask: { count: 2, note: null },
      keep: { count: 2, note: null },
      deleted: { count: 0, note: { tone: "ok", text: "Deleted. No feedback is saved in this browser now." } },
      failed: { count: 2, note: { tone: "error", text: "Your browser wouldn't let Offer Sheet delete the saved feedback." } },
    };

    it("moves focus to the question, back to Delete, to the status line, or back to Delete when the browser refused", () => {
      expect(deleteStep("ask")).toEqual({ confirming: true, focus: "question" });
      expect(deleteStep("keep")).toEqual({ confirming: false, focus: "delete" });
      expect(deleteStep("deleted")).toEqual({ confirming: false, focus: "status" });
      expect(deleteStep("failed")).toEqual({ confirming: false, focus: "delete" });
    });

    it("has that element on the card after each step, ready to take focus", () => {
      for (const step of ["ask", "keep", "deleted", "failed"] as const) {
        const next = deleteStep(step);
        const html = view({ ...after[step], confirming: next.confirming });
        expect(hasTarget(html, next.focus), step).toBe(true);
      }
      // Asking replaces Delete with the confirmation; deleting takes both away and says so; a refusal is an alert.
      const asking = view({ count: 2, confirming: true, note: null });
      expect(asking).not.toMatch(deleteButton);
      expect(asking).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Yes, delete it<\/button><button type="button" class="[^"]*min-h-11[^"]*">Keep it<\/button>/);
      const deleted = view({ count: 0, confirming: false, note: after.deleted.note });
      expect(deleted).not.toMatch(deleteButton);
      expect(deleted).not.toContain("Yes, delete it");
      expect(view({ count: 2, confirming: false, note: after.failed.note })).toMatch(/role="alert"[^>]*><div>Your browser wouldn&#x27;t let Offer Sheet delete/);
    });

    it("keeps the status line mounted and empty while there's nothing to say", () => {
      expect(view({ count: 2, confirming: false, note: null })).toMatch(/<p role="status" tabindex="-1" class="[^"]*sr-only[^"]*"><\/p>/);
    });
  });
});

describe("the /settings route", () => {
  it("is titled Settings, says what it's for, and renders the Settings page", async () => {
    const route = await import("@/app/settings/page");
    expect(route.metadata.title).toBe("Settings");
    expect(String(route.metadata.description)).toContain("positions you stream weekly");
    // Review of Phase 7b: playoff weeks' weight is automatic and read-only (planner reply to Checkpoint 7a, §6.1), and the
    // goal is worded by what the league rewards (5.2), as the page's own NO_LEAGUE_TEXT says.
    expect(String(route.metadata.description)).toContain("what your league rewards");
    expect(String(route.metadata.description)).not.toMatch(/playoff weeks count/);
    const element = route.default();
    expect(element.type).toBe(SettingsPage);
  });
});

describe("saving", () => {
  const view = buildSettingsView({ snapshot: snap, myTeamId: "1", settings: defaultTradeSettings(), stored: true });
  const saved = () => true;

  it("announces each save in one status line that stays mounted (empty until something is saved)", () => {
    const idle = renderToStaticMarkup(createElement(SaveStatus, { status: null }));
    expect(idle).toMatch(/<p role="status" class="[^"]*opacity-0[^"]*"><\/p>/);
    const saved = renderToStaticMarkup(createElement(SaveStatus, { status: { tone: "ok", text: "Saved." } }));
    expect(saved).toMatch(/<p role="status" class="[^"]*opacity-100[^"]*">Saved\.<\/p>/);
    // It never blocks taps on the page under it.
    expect(saved).toContain("pointer-events-none");
  });

  it("shows a failed save as an alert in the league's card, not as 'Saved.'", () => {
    const html = renderToStaticMarkup(createElement(SettingsForm, { view, onEdit: saved, onReset: saved, status: { tone: "error", text: "Storage is blocked." } }));
    expect(html).toMatch(/role="alert"[^>]*>.*That change wasn&#x27;t saved.*Storage is blocked\./);
    expect(html).toMatch(/<p role="status" class="[^"]*opacity-0[^"]*"><\/p>/);
  });
});

describe("keyboard focus when a button goes away with its change (review)", () => {
  const form = (settings: TradeSettings, stored: boolean) =>
    renderToStaticMarkup(createElement(SettingsForm, { view: buildSettingsView({ snapshot: snap, myTeamId: "1", settings, stored }), onEdit: () => true, onReset: () => true, status: null }));

  it("after Reset to defaults: the line saying the league uses the defaults can take focus (it's there with or without saved settings)", () => {
    const savedHtml = form({ ...defaultTradeSettings(), maxPerSide: 3 }, true);
    expect(savedHtml).toMatch(/<p tabindex="-1" class="[^"]*">These are your settings for this league/);
    expect(savedHtml).toMatch(/<button type="button" class="[^"]*">Reset to defaults<\/button>/);
    const defaultsHtml = form(defaultTradeSettings(), false);
    expect(defaultsHtml).toMatch(/<p tabindex="-1" class="[^"]*">This league uses the defaults\./);
    expect(defaultsHtml).not.toContain("Reset to defaults");
  });

  it("after a list's last Remove: its group's legend can take focus (only those two legends)", () => {
    const html = form({ ...defaultTradeSettings(), untouchables: ["999"], mustInclude: ["202"] }, true);
    const focusable = [...html.matchAll(/<legend tabindex="-1"[^>]*>(.*?)<\/legend>/g)].map((m) => m[1]);
    expect(focusable).toEqual(["Untouchables", "Must include"]);
    // A Remove button per saved player who left my team, and per must-include player.
    expect(html.match(/>Remove<span class="sr-only">/g)).toHaveLength(2);
  });

  it("after a Remove: the next row's Remove button, else the new last row's, else the legend; nothing while the row is still there", () => {
    const removed = (id: string, index: number) => ({ id, index });
    expect(focusAfterRemoval(["a", "c"], removed("b", 1))).toBe("c");
    expect(focusAfterRemoval(["b", "c"], removed("a", 0))).toBe("b");
    expect(focusAfterRemoval(["a", "b"], removed("c", 2))).toBe("b");
    expect(focusAfterRemoval([], removed("a", 0))).toBeNull();
    // Not saved (yet): the row is still there, so focus stays on its button.
    expect(focusAfterRemoval(["a", "b"], removed("a", 0))).toBeUndefined();
    // The list changed some other way meanwhile (another tab): still a row that's there.
    expect(focusAfterRemoval(["x"], removed("a", 3))).toBe("x");
  });
});
