/**
 * The Connect page's markup, rendered statically (no DOM, first render only): the ARIA wiring,
 * always-mounted live regions and wording that the review asked for, and the compact phone layout
 * from the planner's reply to Checkpoint 1 (CLAUDE.md §14 item 1). Fictional names only.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { ConnectFlow, PlatformPicker, type PlatformChoice } from "./ConnectFlow";
import { EspnConnect } from "./EspnConnect";
import { EspnPrivateLeague } from "./EspnPrivateLeague";
import { SleeperConnect } from "./SleeperConnect";
import { SleeperLeagueChoices } from "./SleeperLeagueChoices";

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
    expect(radioFor(radios, "yahoo").text).toBe("Yahoo Waiting on Yahoo's approval Coming soon");
    expect(radioFor(radios, "other").text).toBe("Fleaflicker, MFL, Fantrax Fantrax: public leagues Later");
    expect(radioFor(radios, "manual").text).toBe("Manual entry NFL.com, CBS and others Later");
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

describe("SleeperLeagueChoices", () => {
  const choices = {
    username: "zorblax_q",
    season: 2026,
    leagues: [
      { id: "111111111111111111", name: "Alpha Redraft", teams: 10, status: "in_season", leagueType: "redraft" as const, bestBall: false, supported: true },
      { id: "333333333333333333", name: "Zeta Guillotine", teams: 18, status: "in_season", leagueType: "guillotine" as const, bestBall: false, supported: false },
    ],
  };
  const html = renderToStaticMarkup(createElement(SleeperLeagueChoices, { choices, busy: false, onPick: noop }));

  it("explains an unsupported league outside its disabled button, at full contrast", () => {
    const reasonId = "sleeper-league-333333333333333333-reason";
    expect(html).toMatch(new RegExp(`<button type="button" disabled="" aria-describedby="${reasonId}"`));
    expect(html).toMatch(new RegExp(`</button><p id="${reasonId}" class="[^"]*text-warn-fg[^"]*">Guillotine leagues aren&#x27;t supported yet\\.</p>`));
    // The reason isn't inside any button.
    for (const button of html.match(/<button[\s\S]*?<\/button>/g) ?? []) expect(button).not.toContain("supported yet");
  });

  it("lets supported leagues be picked", () => {
    expect(html).toMatch(/<button type="button" class="[^"]*">.*Alpha Redraft.*Import →<\/span><\/button>/);
    expect(html).toContain("Which league?");
  });
});
