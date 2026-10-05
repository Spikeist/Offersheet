/**
 * The Connect page's markup, rendered statically (no DOM, first render only): the ARIA wiring,
 * always-mounted live regions and wording that the review asked for, and the compact phone layout
 * from the planner's reply to Checkpoint 1 (CLAUDE.md §14 item 1). Fictional names only.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
/** What finishImport asks the league store to save (no store in Node: the calls are recorded and answered ok). */
const saves = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/leagueStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagueStore")>();
  return { ...actual, saveLeagueImport: (args: unknown) => (saves.calls.push(args), Promise.resolve({ ok: true as const, id: "espn:00000000:2026" })) };
});

import type { ImportResponse } from "@/lib/api";
import { ConnectFlow, PlatformPicker, savedLeaguesNote, type PlatformChoice } from "./ConnectFlow";
import { ESPN_COOKIES_SAVED, EspnConnect } from "./EspnConnect";
import { EspnPrivateLeague } from "./EspnPrivateLeague";
import { IMPORT_AGAIN_UNAVAILABLE, finishImport, importAgainRequest } from "./finishImport";
import { BATCH_IMPORT_FAILED, BATCH_RUNNING_TEXT, detachedText, resetSleeperBatch, runSleeperBatch, sleeperBatchState, type BatchOutcome } from "./sleeperBatch";
import { SleeperConnect, batchOutcomeText } from "./SleeperConnect";
import { SleeperLeagueChoices, importButtonText, importStateText } from "./SleeperLeagueChoices";

const noop = () => {};

/** Visible text of some markup: tags become spaces, entities are decoded. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const classesOf = (classAttr: string) => classAttr.split(/\s+/);

/** Each platform radio (every radio sits first inside its own label), with its label's classes and text. */
function platformRadios(html: string) {
  return [...html.matchAll(/<label class="([^"]*)">(<input type="radio"[^>]*>)([\s\S]*?)<\/label>/g)].map(([, labelClass = "", input = "", rest = ""]) => ({
    value: /value="([^"]*)"/.exec(input)?.[1],
    name: /name="([^"]*)"/.exec(input)?.[1],
    checked: input.includes(' checked=""'),
    disabled: input.includes(' disabled=""'),
    labelClasses: classesOf(labelClass),
    text: textOf(rest),
  }));
}

function radioFor(radios: ReturnType<typeof platformRadios>, value: string) {
  const radio = radios.find((r) => r.value === value);
  if (!radio) throw new Error(`no ${value} radio`);
  return radio;
}

/** The season picker and the submit button: the row they share, and whether the button is in it. */
function seasonRow(html: string, seasonId: string) {
  const row = new RegExp(`<div class="([^"]*)"><div><label for="${seasonId}"[\\s\\S]*?</select></div>(<button[^>]*>)`).exec(html);
  return { classes: row?.[1], button: row?.[2] };
}

describe("ConnectFlow (first render)", () => {
  const html = renderToStaticMarkup(createElement(ConnectFlow));
  const radios = platformRadios(html);

  it("is one group of native radios named platform, with ESPN checked (§14 item 1)", () => {
    expect(html.match(/<fieldset>/g)).toHaveLength(1);
    expect(html).toContain('<fieldset><legend class="mb-2 text-sm font-bold text-muted">Platform</legend>');
    expect(radios.map((r) => r.value)).toEqual(["espn", "sleeper", "yahoo", "other", "manual"]);
    expect(radios.every((r) => r.name === "platform")).toBe(true);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(["espn"]);
  });

  it("names each radio by its label: the platform, then its note and badge", () => {
    expect(radioFor(radios, "espn").text).toBe("ESPN League link or ID");
    expect(radioFor(radios, "sleeper").text).toBe("Sleeper Username or league ID");
    // As the home page says it (Part B, B3): waiting for Yahoo's approval, never "Coming soon".
    expect(radioFor(radios, "yahoo").text).toBe("Yahoo Sign in with your Yahoo account Waiting for approval");
    expect(radioFor(radios, "other").text).toBe("Fleaflicker, MFL, Fantrax Fantrax: public leagues Later");
    expect(radioFor(radios, "manual").text).toBe("Manual entry NFL.com, CBS and others Later");
  });

  it("never says 'Coming soon' anywhere on the Connect page's components (Part B, B3: the home page says what Yahoo waits for)", () => {
    const dir = fileURLToPath(new URL("./", import.meta.url));
    const sources = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(sources.length).toBeGreaterThan(5);
    for (const f of sources) expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/coming soon/i);
    expect(textOf(html)).not.toMatch(/coming soon/i);
  });

  it("keeps the platforms that aren't ready disabled, unchecked and off the phone layout", () => {
    for (const value of ["yahoo", "other", "manual"]) {
      const radio = radioFor(radios, value);
      expect(radio.disabled).toBe(true);
      expect(radio.checked).toBe(false);
      expect(radio.labelClasses).toEqual(expect.arrayContaining(["hidden", "sm:flex", "cursor-not-allowed", "opacity-60"]));
    }
    for (const value of ["espn", "sleeper"]) expect(radioFor(radios, value).disabled).toBe(false);
  });

  it("phones: a two-segment control with 44 px targets and one line naming what's coming (planner reply to Checkpoint 1)", () => {
    expect(html).toMatch(/<div class="grid grid-cols-2 [^"]*sm:grid-cols-5[^"]*"><label/);
    for (const value of ["espn", "sleeper"]) {
      const classes = radioFor(radios, value).labelClasses;
      expect(classes).toEqual(expect.arrayContaining(["flex", "min-h-11", "items-center", "justify-center", "cursor-pointer"]));
      expect(classes).not.toContain("hidden");
    }
    // A segment is just the name; the notes come back with the cards.
    expect(html).toContain('<span class="mt-1 text-xs text-muted hidden sm:block">League link or ID</span>');
    expect(html).toContain('<span class="mt-1 text-xs text-muted hidden sm:block">Username or league ID</span>');
    expect(html).toContain('<p class="mt-2 text-sm text-muted sm:hidden">Yahoo, Fleaflicker, MFL, Fantrax and manual entry are coming.</p>');
  });

  it("from sm up: the five cards as before, the selected one ringed", () => {
    for (const r of radios) expect(r.labelClasses).toEqual(expect.arrayContaining(["sm:min-h-20", "sm:flex-col", "sm:rounded-2xl", "sm:border", "sm:p-3"]));
    expect(radioFor(radios, "espn").labelClasses).toEqual(expect.arrayContaining(["bg-brand-soft", "ring-2", "ring-brand", "sm:border-brand"]));
    expect(radioFor(radios, "sleeper").labelClasses).not.toContain("ring-2");
    expect(radioFor(radios, "sleeper").labelClasses).toContain("sm:border-line");
  });

  it("shows keyboard focus on the label, since the radio itself is visually hidden", () => {
    const inputs = html.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(5);
    for (const input of inputs) expect(input).toContain(' class="sr-only"');
    for (const r of radios) {
      expect(r.labelClasses).toEqual(expect.arrayContaining(["relative", "has-[:focus-visible]:outline-3", "has-[:focus-visible]:outline-focus"]));
      // transition-colors would fade the ring in from the text color; this one leaves outline-color out.
      expect(r.labelClasses).toContain("transition-[color,background-color,border-color]");
      expect(r.labelClasses).not.toContain("transition-colors");
    }
  });

  it("shows the ESPN form under the picker", () => {
    expect(html).toContain('id="espn-league"');
    expect(html).not.toContain('id="sleeper-username"');
  });
});

describe("PlatformPicker", () => {
  type ElementProps = { type?: string; value?: string; onChange?: () => void; children?: ReactNode };

  /** The radios in the element tree PlatformPicker returns (it uses no hooks, so it can be called directly). */
  function radioElements(node: ReactNode): ReactElement<ElementProps>[] {
    const found: ReactElement<ElementProps>[] = [];
    const walk = (n: ReactNode): void => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (isValidElement<ElementProps>(n)) {
        if (n.type === "input" && n.props.type === "radio") found.push(n);
        walk(n.props.children);
      }
    };
    walk(node);
    return found;
  }

  it("checks and rings the platform it's given", () => {
    const radios = platformRadios(renderToStaticMarkup(createElement(PlatformPicker, { value: "sleeper", onChange: noop })));
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(["sleeper"]);
    expect(radioFor(radios, "sleeper").labelClasses).toContain("ring-2");
    expect(radioFor(radios, "espn").labelClasses).not.toContain("ring-2");
    expect(radioFor(radios, "espn").labelClasses).toContain("text-muted");
  });

  it("only ever reports ESPN or Sleeper as the choice", () => {
    const picked: PlatformChoice[] = [];
    const radios = radioElements(PlatformPicker({ value: "espn", onChange: (p) => picked.push(p) }));
    expect(radios.map((r) => r.props.value)).toEqual(["espn", "sleeper", "yahoo", "other", "manual"]);
    for (const radio of radios) radio.props.onChange?.();
    expect(picked).toEqual(["espn", "sleeper"]);
  });
});

describe("EspnConnect (first render)", () => {
  const html = renderToStaticMarkup(createElement(EspnConnect));

  it("keeps its live regions mounted before anything happens", () => {
    // What the field understood, the loading text, and the "cookies are gone" status.
    expect(html).toContain('<div aria-live="polite"></div>');
    expect(html).toContain('<p aria-live="polite"></p>');
    expect(html).toMatch(/<p role="status" tabindex="-1" class="scroll-my-4"><\/p>/);
  });

  it("describes the input by its help text, and isn't marked invalid yet", () => {
    expect(html).toMatch(/<input[^>]*id="espn-league"[^>]*aria-describedby="espn-league-help"/);
    expect(html).not.toMatch(/<input[^>]*id="espn-league"[^>]*aria-invalid/);
  });

  it("puts Season and Import side by side, phones included (planner reply to Checkpoint 1)", () => {
    const row = seasonRow(html, "espn-season");
    expect(row.classes).toBe("grid grid-cols-[minmax(0,7rem)_1fr] items-end gap-4 sm:grid-cols-[12rem_1fr]");
    expect(row.button).toMatch(/type="submit"/);
  });
});

describe("EspnPrivateLeague", () => {
  const privateError = { code: "PRIVATE_LEAGUE" as const, message: "This ESPN league is private, so ESPN only shares it with a login." };

  it("puts the private-league explanation in a focusable callout (focus moves there, so no role=alert)", () => {
    const html = renderToStaticMarkup(createElement(EspnPrivateLeague, { error: privateError, session: null, onSessionChange: noop, onCookiesSaved: noop, onForget: noop, busy: false }));
    expect(html).toMatch(/<div tabindex="-1" class="scroll-my-4 rounded-xl"><div class="[^"]*"><p class="font-bold">This league is private<\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it("says plainly how long the cookies last", () => {
    const html = renderToStaticMarkup(createElement(EspnPrivateLeague, { error: privateError, session: { connected: false, available: true }, onSessionChange: noop, onCookiesSaved: noop, onForget: noop, busy: false }));
    expect(html).toContain("deleted when you close your browser, and unusable after 12 hours at most");
    expect(html).toContain("Our server never stores them.");
    expect(html).not.toContain("gone when you close your browser");
  });

  it("offers Forget when cookies are saved", () => {
    const html = renderToStaticMarkup(createElement(EspnPrivateLeague, { error: null, session: { connected: true, available: true }, onSessionChange: noop, onCookiesSaved: noop, onForget: noop, busy: false }));
    expect(html).toContain("Forget my credentials</button>");
  });

  it("gives its small buttons 44 px targets: Forget, and Copy message for the commissioner (review of Phase 4: small buttons were 36 px)", () => {
    const saved = renderToStaticMarkup(createElement(EspnPrivateLeague, { error: null, session: { connected: true, available: true }, onSessionChange: noop, onCookiesSaved: noop, onForget: noop, busy: false }));
    expect(saved).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*">Forget my credentials<\/button>/);
    const ask = renderToStaticMarkup(createElement(EspnPrivateLeague, { error: privateError, session: null, onSessionChange: noop, onCookiesSaved: noop, onForget: noop, busy: false }));
    expect(ask).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*" aria-live="polite">Copy message<\/button>/);
  });
});

describe("SleeperConnect (first render)", () => {
  const html = renderToStaticMarkup(createElement(SleeperConnect));

  it("keeps its status and loading live regions mounted", () => {
    expect(html).toContain('<p role="status"></p>');
    expect(html).toContain('<p aria-live="polite"></p>');
  });

  it("makes Username and League ID 44 px targets (review of Phase 4: 36 px)", () => {
    const toggles = [...html.matchAll(/<button type="button" aria-pressed="(?:true|false)" class="([^"]*)">([^<]*)<\/button>/g)].map((m) => ({ cls: m[1] ?? "", text: m[2] }));
    expect(toggles.map((t) => t.text)).toEqual(["Username", "League ID"]);
    for (const t of toggles) expect(t.cls).toContain("min-h-11");
  });

  it("describes the username field by its help text", () => {
    expect(html).toMatch(/<input[^>]*id="sleeper-username"[^>]*aria-describedby="sleeper-username-help"/);
    expect(html).toContain('id="sleeper-username-help"');
  });

  it("puts Season and the button side by side, like the ESPN form", () => {
    const row = seasonRow(html, "sleeper-season");
    expect(row.classes).toBe("grid grid-cols-[minmax(0,7rem)_1fr] items-end gap-4 sm:grid-cols-[12rem_1fr]");
    expect(row.button).toMatch(/type="submit"/);
  });
});

describe("SleeperLeagueChoices: several at once (planner reply to Checkpoint 4b, change 11)", () => {
  const choices = {
    username: "zorblax_q",
    season: 2026,
    leagues: [
      { id: "111111111111111111", name: "Alpha Redraft", teams: 10, status: "in_season", leagueType: "redraft" as const, bestBall: false, supported: true },
      { id: "222222222222222222", name: "Beta Dynasty", teams: 12, status: "in_season", leagueType: "dynasty" as const, bestBall: true, supported: true },
      { id: "333333333333333333", name: "Zeta Guillotine", teams: 18, status: "in_season", leagueType: "guillotine" as const, bestBall: false, supported: false },
    ],
  };
  const render = (props: Partial<Parameters<typeof SleeperLeagueChoices>[0]> = {}) =>
    renderToStaticMarkup(createElement(SleeperLeagueChoices, { choices, busy: false, saved: new Set<string>(), results: {}, onImport: noop, ...props }));
  const html = render();

  it("lists every league as a labeled native checkbox in a 44 px row, inside one described group", () => {
    const boxes = [...html.matchAll(/<label class="([^"]*)"><input type="checkbox"([^>]*)\/>([\s\S]*?)<\/label>/g)].map(([, cls = "", , inner = ""]) => ({ cls, text: textOf(inner) }));
    expect(boxes.map((b) => b.text)).toEqual(["Alpha Redraft Redraft · 10 teams · In season", "Beta Dynasty Dynasty · best ball · 12 teams · In season", "Zeta Guillotine 18 teams · In season"]);
    for (const b of boxes) expect(b.cls).toContain("min-h-11");
    expect(html).toMatch(/<fieldset aria-describedby="([^"]+)"><legend class="sr-only">Leagues to import<\/legend><p id="\1"/);
    expect(html).toContain("Which leagues?");
  });

  it("explains an unsupported league outside its disabled checkbox, at full contrast", () => {
    const reasonId = "sleeper-league-333333333333333333-reason";
    expect(html).toMatch(new RegExp(`<input type="checkbox" disabled="" aria-describedby="${reasonId}"`));
    expect(html).toMatch(new RegExp(`</label><p id="${reasonId}" class="[^"]*text-warn-fg[^"]*">Guillotine leagues aren&#x27;t supported yet\\.</p>`));
    // The reason isn't inside any label.
    for (const label of html.match(/<label[\s\S]*?<\/label>/g) ?? []) expect(label).not.toContain("supported yet");
  });

  it("starts with none picked: Import says so and waits (aria-disabled keeps it focusable)", () => {
    expect(html).not.toMatch(/<input type="checkbox" checked=""/);
    expect(html).toMatch(/<button type="submit" aria-disabled="true" class="[^"]*">Import leagues<\/button>/);
    expect(importButtonText(1, false)).toBe("Import 1 league");
    expect(importButtonText(3, false)).toBe("Import 3 leagues");
    expect(importButtonText(3, true)).toBe("Importing…");
  });

  it("marks the leagues already saved in this browser", () => {
    const savedHtml = render({ saved: new Set(["222222222222222222"]) });
    expect(textOf(savedHtml)).toContain("Beta Dynasty Dynasty · best ball · 12 teams · In season Saved");
    expect(textOf(savedHtml)).not.toContain("Alpha Redraft Redraft · 10 teams · In season Saved");
  });

  it("says under each league how its import went", () => {
    const during = render({ busy: true, results: { "111111111111111111": { kind: "done" }, "222222222222222222": { kind: "failed", message: "Sleeper isn't responding right now." } } });
    expect(textOf(during)).toContain("Alpha Redraft Redraft · 10 teams · In season Imported and saved.");
    expect(textOf(during)).toContain("Didn't import: Sleeper isn't responding right now.");
    expect(importStateText({ kind: "waiting" })).toBe("Waiting…");
    expect(importStateText({ kind: "importing" })).toBe("Importing…");
    expect(importStateText(undefined)).toBeNull();
  });

  it("says how a batch went when some leagues didn't import (all imported: the Import Report opens)", () => {
    expect(batchOutcomeText(2, 3)).toBe("Imported 2 of 3 leagues. See why the others didn't under each.");
    expect(batchOutcomeText(0, 3)).toBe("None of the 3 leagues imported: see why under each.");
    expect(batchOutcomeText(0, 1)).toBe("That league didn't import: see why below.");
  });
});

describe("several saved leagues (planner reply to Checkpoint 4b, change 11)", () => {
  it("says, under the form, that an import joins the leagues saved here (nothing with none saved)", () => {
    expect(savedLeaguesNote(0)).toBeNull();
    expect(savedLeaguesNote(1)).toBe("You have 1 league saved in this browser. A league you import joins it (or updates its saved copy) and shows right away; switch leagues at the top of any page.");
    expect(savedLeaguesNote(3)).toContain("You have 3 leagues saved in this browser. A league you import joins them");
    // The first render (the store isn't read on the server) says nothing.
    expect(renderToStaticMarkup(createElement(ConnectFlow))).not.toContain("saved in this browser");
  });

  it("says the session's ESPN cookies cover every league of that ESPN account, so another league needs only its link", () => {
    expect(ESPN_COOKIES_SAVED).toBe(
      "Your ESPN cookies are saved for this browser session. They work for every league of that ESPN account, private ones included, so to add another league just paste its link.",
    );
  });

  it("imports a league saved by an earlier version again from its request summary, the way the Connect page does", () => {
    expect(importAgainRequest({ platform: "espn", season: 2026, leagueId: "4242" })).toEqual({ url: "/api/import/espn", body: { leagueId: "4242", season: 2026 } });
    expect(importAgainRequest({ platform: "sleeper", season: 2026, leagueId: "123456789012345678", username: "@zorblax_q " })).toEqual({
      url: "/api/import/sleeper",
      body: { season: 2026, leagueId: "123456789012345678", username: "zorblax_q" },
    });
    // Something that isn't a username is left out; no league id, or a platform without an import yet: the Connect page.
    expect(importAgainRequest({ platform: "sleeper", season: 2026, leagueId: "123456789012345678", username: "not a username" })?.body).toEqual({ season: 2026, leagueId: "123456789012345678" });
    expect(importAgainRequest({ platform: "sleeper", season: 2026, username: "zorblax_q" })).toBeNull();
    expect(importAgainRequest({ platform: "yahoo", season: 2026, leagueId: "1" })).toBeNull();
    expect(IMPORT_AGAIN_UNAVAILABLE).toBe("Import it again from the Connect page.");
  });

  it("passes a batch's makeCurrent and Refresh's update-only flag to the league store, and a pasted link's team as a hint (review of track ML)", async () => {
    saves.calls.length = 0;
    const request = { platform: "espn" as const, season: 2026, leagueId: "4242" };
    const response = { snapshot: { platform: "espn", leagueId: "4242", season: 2026 }, notes: [] } as unknown as ImportResponse;
    await finishImport(request, response, undefined, { makeCurrent: false, ifSaved: true });
    await finishImport(request, response, "3");
    expect(saves.calls).toEqual([
      { request, response, savedAt: expect.any(String), makeCurrent: false, ifSaved: true },
      { request, response, savedAt: expect.any(String), teamHint: "3" },
    ]);
  });
});

describe("a batch of Sleeper leagues outlives the Connect page (sleeperBatch.ts; review of track ML)", () => {
  afterEach(() => resetSleeperBatch());

  /** Lets the batch's awaits run. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * One fake import per league, answered when the test releases it (`ok[id]`, default true): what it does at the save
   * (the tab's league or saved alongside, asking makeCurrent() only once the league is in, as SleeperConnect does), and
   * how many ran at once.
   */
  function fakeImports(ok: Record<string, boolean> = {}) {
    const release = new Map<string, () => void>();
    const log: string[] = [];
    let running = 0;
    let most = 0;
    const importOne = (id: string, makeCurrent: () => boolean) =>
      new Promise<BatchOutcome>((resolve) => {
        running++;
        most = Math.max(most, running);
        log.push(`start ${id}`);
        release.set(id, () => {
          running--;
          const good = ok[id] ?? true;
          log.push(`${id} ${good ? (makeCurrent() ? "shown" : "alongside") : "failed"}`);
          resolve(good ? { ok: true } : { ok: false, message: "Sleeper isn't responding right now." });
        });
      });
    return { importOne, release: (id: string) => release.get(id)?.(), log, most: () => most };
  }

  it("imports one league at a time while the page is open: the first one imported is shown, the others saved alongside", async () => {
    const f = fakeImports({ a: false });
    const run = runSleeperBatch(["a", "b", "c"], { importOne: f.importOne, attached: () => true });
    expect(sleeperBatchState().running).toBe(true);
    for (const id of ["a", "b", "c"]) {
      await tick();
      f.release(id);
    }
    expect(await run).toEqual({ imported: 2, notStarted: 0 });
    expect(f.log).toEqual(["start a", "a failed", "start b", "b shown", "start c", "c alongside"]);
    expect(f.most()).toBe(1);
    expect(sleeperBatchState()).toEqual({ running: false, detached: null });
  });

  it("stops once the page is left: the league under way is saved alongside, no new one starts, nothing else can start meanwhile, and the page opened again says how it ended", async () => {
    let open = true;
    const f = fakeImports();
    const run = runSleeperBatch(["a", "b", "c"], { importOne: f.importOne, attached: () => open });
    await tick();
    f.release("a");
    await tick();
    open = false; // left while b is under way (another page, or the platform picker's ESPN)
    expect(await runSleeperBatch(["d"], { importOne: f.importOne, attached: () => true })).toBeNull();
    // The Connect page opened again meanwhile: it says so, and its button waits.
    const waiting = renderToStaticMarkup(createElement(SleeperConnect));
    expect(textOf(waiting)).toContain(BATCH_RUNNING_TEXT);
    expect(waiting).toMatch(/<button type="submit" class="[^"]*" disabled="">.*Working…<\/button>/);
    f.release("b");
    expect(await run).toEqual({ imported: 2, notStarted: 1 });
    expect(f.log).toEqual(["start a", "a shown", "start b", "b alongside"]);
    expect(sleeperBatchState()).toEqual({ running: false, detached: { imported: 2, total: 3 } });
    const after = renderToStaticMarkup(createElement(SleeperConnect));
    expect(textOf(after)).toContain("Your Sleeper import stopped when you left this page: 2 of 3 leagues imported (switch leagues at the top of any page). Pick the others again to import them.");
    expect(after).not.toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it("saves even the first league alongside when the page is left before it's in (the tab keeps the league it shows)", async () => {
    let open = true;
    const f = fakeImports();
    const run = runSleeperBatch(["a", "b"], { importOne: f.importOne, attached: () => open });
    await tick();
    open = false;
    f.release("a");
    expect(await run).toEqual({ imported: 1, notStarted: 1 });
    expect(f.log).toEqual(["start a", "a alongside"]);
    expect(sleeperBatchState().detached).toEqual({ imported: 1, total: 2 });
  });

  it("counts a league whose import throws as failed, and says how a batch ended after its page was left", async () => {
    const run = runSleeperBatch(["a"], {
      importOne: () => Promise.reject(new Error("unexpected")),
      attached: () => true,
    });
    expect(await run).toEqual({ imported: 0, notStarted: 0 });
    let ended: BatchOutcome | null = null;
    await runSleeperBatch(["a"], { importOne: () => Promise.reject(new Error("unexpected")), attached: () => true, onEnd: (_id, outcome) => (ended = outcome) });
    expect(ended).toEqual({ ok: false, message: BATCH_IMPORT_FAILED });
    expect(detachedText({ imported: 3, total: 3 })).toBe("Your Sleeper import finished after you left this page: all 3 leagues are saved. Switch leagues at the top of any page.");
    expect(detachedText({ imported: 1, total: 1 })).toBe("Your Sleeper import finished after you left this page: the league is saved. Switch leagues at the top of any page.");
    expect(detachedText({ imported: 0, total: 3 })).toBe("Your Sleeper import stopped when you left this page: none of the 3 leagues imported. Pick them again to import them.");
    expect(detachedText({ imported: 0, total: 1 })).toBe("Your Sleeper import stopped when you left this page: the league didn't import. Pick it again to import it.");
  });
});
