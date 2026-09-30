/**
 * The Connect page's markup, rendered statically (no DOM, first render only): the ARIA wiring,
 * always-mounted live regions and wording that the review asked for. Fictional names only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { EspnConnect } from "./EspnConnect";
import { EspnPrivateLeague } from "./EspnPrivateLeague";
import { SleeperConnect } from "./SleeperConnect";
import { SleeperLeagueChoices } from "./SleeperLeagueChoices";

const noop = () => {};

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
});

describe("SleeperConnect (first render)", () => {
  const html = renderToStaticMarkup(createElement(SleeperConnect));

  it("keeps its status and loading live regions mounted", () => {
    expect(html).toContain('<p role="status"></p>');
    expect(html).toContain('<p aria-live="polite"></p>');
  });

  it("describes the username field by its help text", () => {
    expect(html).toMatch(/<input[^>]*id="sleeper-username"[^>]*aria-describedby="sleeper-username-help"/);
    expect(html).toContain('id="sleeper-username-help"');
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
