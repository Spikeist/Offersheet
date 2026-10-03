/**
 * The Settings page (CLAUDE.md §14 item 6; lead decision L12), rendered statically (first render only) with the
 * tab's sessionStorage (the import, "my team") and the browser's localStorage (settings, feedback) faked through
 * their hooks: without a league it says settings need one (and the feedback card is still there), an import from
 * an earlier version asks for the league again, and with a league every setting is a labeled native control in a
 * fieldset, checked as saved. A small made-up league; every name is invented.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { FEEDBACK_STORAGE_KEY, applyFeedback, type FeedbackRecord } from "@/lib/feedbackStore";
import { IMPORT_FORMAT_VERSION, IMPORT_STORAGE_KEY, OUTDATED_IMPORT_TITLE, myTeamKey, type StoredImport } from "@/lib/importStore";
import { SETTINGS_STORAGE_KEY, leagueKey } from "@/lib/settingsStore";
import { FeedbackCardView, deleteStep, feedbackCountText, type DeleteFocus, type DeleteStep, type FeedbackNote } from "./FeedbackCard";
import { SaveStatus, SettingsForm, focusAfterRemoval } from "./SettingsForm";
import { NO_LEAGUE_TITLE, OUTDATED_TEXT, SettingsPage } from "./SettingsPage";
import { buildSettingsView } from "./settingsView";
import { snapshot } from "./testFixtures";

/** This tab's sessionStorage and the browser's localStorage as the hooks read them (undefined = not read yet). */
const stores = vi.hoisted(() => ({ session: new Map<string, string>(), local: new Map<string, string>(), localReady: true }));
vi.mock("@/lib/useSessionValue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSessionValue")>()),
  useSessionValue: (key: string) => stores.session.get(key) ?? null,
}));
vi.mock("./useLocalValue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useLocalValue")>()),
  useLocalValue: (key: string) => (stores.localReady ? (stores.local.get(key) ?? null) : undefined),
}));

const snap = snapshot();
const stored: StoredImport = { version: IMPORT_FORMAT_VERSION, savedAt: "2026-09-30T20:00:00.000Z", request: { platform: "espn", season: 2026, leagueId: snap.leagueId }, response: { snapshot: snap, notes: [] } };

function render(opts: { importValue?: unknown; myTeam?: string; settings?: TradeSettings; feedback?: FeedbackRecord[]; localReady?: boolean } = {}): string {
  stores.session.clear();
  stores.local.clear();
  stores.localReady = opts.localReady ?? true;
  if (opts.importValue !== undefined) stores.session.set(IMPORT_STORAGE_KEY, JSON.stringify(opts.importValue));
  if (opts.myTeam) stores.session.set(myTeamKey(snap), JSON.stringify({ teamId: opts.myTeam, source: "you" }));
  if (opts.settings) stores.local.set(SETTINGS_STORAGE_KEY, JSON.stringify({ [leagueKey(snap)]: opts.settings }));
  if (opts.feedback) stores.local.set(FEEDBACK_STORAGE_KEY, JSON.stringify(opts.feedback));
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
  stores.session.clear();
  stores.local.clear();
  stores.localReady = true;
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

  it("asks for the league again when the import is from an earlier version of Offer Sheet", () => {
    const text = textOf(render({ importValue: { ...stored, version: 1 } }));
    expect(text).toContain(OUTDATED_IMPORT_TITLE);
    expect(text).toContain(OUTDATED_TEXT);
    expect(text).not.toContain(NO_LEAGUE_TITLE);
  });

  it("has one page heading: the cards' headings are h2", () => {
    expect(render().match(/<h1[ >]/g)).toHaveLength(1);
  });
});

describe("with a league", () => {
  it("waits for the browser's storage before showing settings (server render and hydration)", () => {
    const text = textOf(render({ importValue: stored, myTeam: "1", localReady: false }));
    expect(text).toContain("Loading your settings…");
    expect(text).not.toContain("Positions I stream weekly");
  });

  it("shows every setting as a labeled group, with the defaults checked when nothing is saved", () => {
    const html = render({ importValue: stored, myTeam: "1" });
    expect(radioChecked(html, "playoff-weight")).toEqual(["1.25"]);
    expect(radioChecked(html, "max-per-side")).toEqual(["2"]);
    expect(radioChecked(html, "protect-value")).toEqual(["medium"]);
    const legends = [...html.matchAll(/<legend[^>]*>(.*?)<\/legend>/g)].map((m) => textOf(m[1] ?? ""));
    expect(legends).toEqual([
      "Positions I stream weekly",
      "Playoff weeks count",
      "Most players per side",
      "Protect my trade value",
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
    // Win now ↔ Future and draft picks are for dynasty and keeper leagues only.
    expect(textOf(html)).not.toContain("Win now");
    expect(textOf(html)).not.toContain("Include draft picks");
  });

  it("checks what's saved, and offers Reset to defaults", () => {
    const settings: TradeSettings = { ...defaultTradeSettings(), streamPositions: ["DEF", "TE"], playoffWeight: 1.5, maxPerSide: 3, untouchables: ["103"], mustInclude: ["202"], avoidPositions: ["TE"], protectValue: "high" };
    const html = render({ importValue: stored, myTeam: "1", settings });
    const boxes = checkboxes(html);
    expect(boxes.slice(0, 4).map(([, c]) => c)).toEqual([false, true, false, true]);
    expect(boxes).toContainEqual(["Cal Catcher WR · SEA", true]);
    expect(boxes).toContainEqual(["Abe Runner RB · DAL", false]);
    expect(radioChecked(html, "playoff-weight")).toEqual(["1.5"]);
    expect(radioChecked(html, "max-per-side")).toEqual(["3"]);
    expect(radioChecked(html, "protect-value")).toEqual(["high"]);
    expect(textOf(html)).toContain("Rex Rusher · RB · DET Team Two");
    expect(html).toMatch(/<button type="button" class="[^"]*">Remove<span class="sr-only"> Rex Rusher<\/span><\/button>/);
    expect(textOf(html)).toContain("These are your settings for this league");
    expect(html).toMatch(/<button type="button" class="[^"]*">Reset to defaults<\/button>/);
  });

  it("links each group's help text to its fieldset, and gives every control a 44 px target", () => {
    const html = render({ importValue: stored, myTeam: "1" });
    for (const [, id] of html.matchAll(/<fieldset aria-describedby="([^"]+)"/g)) expect(html).toContain(`<p id="${id}" class=`);
    expect(html.match(/<fieldset aria-describedby=/g)?.length).toBeGreaterThanOrEqual(6);
    for (const [label] of html.matchAll(/<label class="[^"]*"><input type="(?:checkbox|radio)"/g)) expect(label).toContain("min-h-11");
    // The must-include picker: a labeled select grouped by team (mine first), with an Add button.
    expect(html).toMatch(/<label for="([^"]+)" class="sr-only">Player to include<\/label><select id="\1"/);
    expect([...html.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1])).toEqual(["Your team", "Team Two", "Team Three"]);
  });

  it("points to the Import Report when it doesn't know which team is mine", () => {
    const html = render({ importValue: stored });
    expect(textOf(html)).toContain("Pick your team on the Import Report first");
    expect(html).toContain('href="/import#your-team"');
    expect(html).not.toMatch(/<legend[^>]*>Untouchables<\/legend>/);
    expect(html).not.toMatch(/<legend[^>]*>Must include<\/legend>/);
  });

  it("shows Win now ↔ Future and draft picks in a dynasty league", () => {
    const dynasty = { ...stored, response: { ...stored.response, snapshot: snapshot({ leagueType: "dynasty" }) } };
    const html = render({ importValue: dynasty, myTeam: "1", settings: { ...defaultTradeSettings(), lambda: 0.25 } });
    const text = textOf(html);
    expect(text).toContain("Win now or build for the future");
    expect(text).toContain("Mostly this season: later seasons count 25%");
    expect(text).toContain("Include draft picks");
    // "Protect my trade value" is for redraft leagues: long-term value counts here instead.
    expect(text).not.toContain("Protect my trade value");
    expect(html).not.toContain('name="protect-value"');
    // The slider is labeled and reads its value out in words; the same words show under it, hidden from screen readers.
    expect(html).toMatch(/<label for="([^"]+)" class="sr-only">How much later seasons count<\/label><input id="\1" type="range" min="0" max="1" step="0.05" aria-valuetext="Mostly this season: later seasons count 25%"[^>]*value="0.25"/);
    expect(html).toContain('<p class="mt-1 text-sm font-semibold" aria-hidden="true">Mostly this season: later seasons count 25%</p>');
  });

  it("links a checkbox's longer help to it as a description, not as part of its name", () => {
    const dynasty = { ...stored, response: { ...stored.response, snapshot: snapshot({ leagueType: "dynasty" }) } };
    const html = render({ importValue: dynasty, myTeam: "1" });
    const described = [...html.matchAll(/<input type="checkbox"[^>]*aria-describedby="([^"]+)"[^>]*\/>(.*?)<\/label><p id="\1"[^>]*>(.*?)<\/p>/g)].map(([, , name = "", help = ""]) => [textOf(name), textOf(help).slice(0, 30)]);
    expect(described).toEqual([
      ["Automatic", "Set from your playoff odds: la"],
      ["Include kickers and D/STs in trade ideas", "Off by default: managers rarel"],
      ["Include draft picks", "Adds future draft picks, yours"],
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

  it("says what the exported file holds: ID numbers, numbers and notes, no names, leagues only numbered (review)", () => {
    const text = textOf(render({ feedback: records }));
    expect(text).toContain("The file holds player and team ID numbers and Offer Sheet's numbers for each trade, plus any notes you typed.");
    expect(text).toContain("It has no names, and it numbers your leagues (league-1, league-2) rather than saying which they are.");
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
      const question = /<p id="([^"]+)" tabindex="-1" class="[^"]*">Delete the feedback on 2 trade ideas\? You can&#x27;t undo this\.<\/p>/.exec(html);
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
    const savedHtml = form({ ...defaultTradeSettings(), playoffWeight: 1.5 }, true);
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
