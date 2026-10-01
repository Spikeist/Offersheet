/**
 * The Import Report's markup, rendered statically (no DOM): the wording and ARIA wiring the view
 * model feeds it. Every name is made up.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import type { ImportResponse } from "@/lib/api";
import { buildImportReport, type ReportOptions } from "@/lib/importReport";
import { ReportView, type ForgetControl, type RefreshControl } from "./ReportView";

const settings: LeagueSettings = {
  numTeams: 2,
  leagueType: "redraft",
  lineup: [
    { slot: "QB", count: 1, eligible: ["QB"] },
    { slot: "K", count: 1, eligible: ["K"] },
  ],
  benchSlots: 5,
  irSlots: 1,
  taxiSlots: 0,
  maxRosterSize: 7,
  scoring: { perStat: { pass_td: 4, fgm_40_49: 4 }, rules: [{ kind: "perUnit", stat: { sum: ["fgm_0_19", "fgm_20_29", "fgm_30_39"] }, points: 3 }], unmapped: [] },
  regularSeasonWeeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  playoffWeeks: [15, 16, 17],
  playoffTeams: 2,
  playoffByes: 0,
  medianGame: false,
  pointsOnly: false,
  tradeDeadline: { week: 11 },
  tradeReview: "commissioner",
};

function snapshot(overrides: Partial<LeagueSnapshot> = {}, settingsOverrides: Partial<LeagueSettings> = {}): LeagueSnapshot {
  return {
    platform: "espn",
    leagueId: "4242",
    season: 2026,
    name: "The Gloopdorf Invitational",
    fetchedAt: "2026-09-29T23:00:00.000Z",
    currentWeek: 4,
    settings: { ...settings, ...settingsOverrides },
    teams: [
      { id: "1", name: "Moonbeam Mudcats", ownerName: "Zorblax Quintavious", roster: [], ir: [], taxi: [], record: { w: 2, l: 1, t: 0 }, pointsFor: 300, pointsAgainst: 280 },
      { id: "3", name: "Quasar Quokkas", ownerName: "Quenby Flapdoodle", roster: [], ir: [], taxi: [], record: { w: 1, l: 2, t: 0 }, pointsFor: 280, pointsAgainst: 300 },
    ],
    myTeamId: null,
    players: {},
    schedule: [],
    transactions: [],
    freeAgents: [],
    warnings: [],
    ...overrides,
  };
}

function render(response: ImportResponse, opts: Partial<ReportOptions> = {}, controls: { refresh?: RefreshControl; forget?: ForgetControl } = {}): string {
  const view = buildImportReport(response, { timeZone: "America/Chicago", ...opts });
  return renderToStaticMarkup(createElement(ReportView, { view, onPickTeam: () => {}, ...controls }));
}

const noop = () => {};

describe("ReportView", () => {
  it("links to the League page, and says trade ideas come later", () => {
    const html = render({ snapshot: snapshot(), notes: [] });
    expect(html).toMatch(/<a class="[^"]*min-h-11[^"]*" href="\/league">See your league&#x27;s needs and projections\u00a0→<\/a>/);
    expect(html).toContain("Trade ideas come in a later update.");
    expect(html).not.toContain("Trade ideas arrive in a later update.");
  });

  it("names the FantasyCalc format next to a 'Values: FantasyCalc' link (§2.9), and notes each substitution", () => {
    const html = render({ snapshot: snapshot(), notes: [] });
    // Two teams → FantasyCalc's smallest supported size (8).
    expect(html).toMatch(
      /<dt[^>]*>Trade values<\/dt><dd[^>]*>FantasyCalc · 8 teams · non-PPR · 1 QB · redraft · <a href="https:\/\/fantasycalc\.com" target="_blank" rel="noopener noreferrer"[^>]*>Values: FantasyCalc<span class="sr-only"> \(opens in a new tab\)<\/span><\/a><\/dd>/,
    );
    expect(html).toMatch(/<li class="rounded-xl bg-surface-muted[^"]*">Trade values: 2 teams → FantasyCalc&#x27;s 8-team values\.<\/li>/);
    expect(html).not.toContain("No warnings. Everything we read mapped cleanly.");
  });

  it("adds the League page's projection source to the notes once its inputs are stored", () => {
    const model = {
      version: 1 as const,
      season: 2026,
      currentWeek: 4,
      lastWeek: 17,
      builtAt: "2026-09-30T02:00:00.000Z",
      nfl: { byeWeek: {}, kickoffs: {} },
      // Sleeper's projections loaded (one projected player), ESPN's didn't.
      players: { "9001": { sleeper: { 4: 18 }, actual: {} } },
      espnProjections: false,
      market: null,
      sources: [],
      warnings: [],
      notes: [],
    };
    const html = render({ snapshot: snapshot({}, { numTeams: 10 }), notes: [] }, { model });
    expect(html).toContain("Projection source: Sleeper&#x27;s projections, scored with your league&#x27;s rules. ESPN&#x27;s own projections didn&#x27;t load, so they aren&#x27;t averaged in.");
  });

  it("shows a team from a pasted link as one to check, never as found by ESPN", () => {
    const html = render({ snapshot: snapshot(), notes: [] }, { myTeamId: "3", myTeamSource: "link" });
    expect(html).toContain("From your link — check it");
    expect(html).toContain("Quasar Quokkas (from your link)");
    expect(html).not.toMatch(/found by ESPN/i);
    expect(html).toContain('aria-describedby="my-team-explain"');
    // The team is already selected, so confirming it takes a button.
    expect(html).toContain("Yes, that&#x27;s my team</button>");
    expect(render({ snapshot: snapshot(), notes: [] }, { myTeamId: "3", myTeamSource: "you" })).not.toContain("that&#x27;s my team");
  });

  it("marks settings the platform doesn't expose as unknown, in the warn tone", () => {
    const html = render({ snapshot: snapshot({}, { unknownSettings: ["tradeDeadline"], tradeDeadline: null }), notes: [] });
    expect(html).toMatch(/<dd class="[^"]*text-warn-fg[^"]*">Unknown — check your league&#x27;s settings<\/dd>/);
    expect(html).not.toContain("No trade deadline");
  });

  it("says how ties in the standings are broken, in the warn tone when unknown, and which weeks have final scores (§8)", () => {
    const known = render({ snapshot: snapshot({ schedule: [{ week: 1, teamA: "1", teamB: "3", isPlayoff: false, result: { pointsA: 101.5, pointsB: 99, winnerId: "1" } }] }, { seedingTiebreaker: "pointsFor" }), notes: [] });
    expect(known).toMatch(/<dt[^>]*>Ties in the standings<\/dt><dd class="(?![^"]*text-warn-fg)[^"]*">Points for<\/dd>/);
    expect(known).toMatch(/<dt[^>]*>Final scores<\/dt><dd[^>]*>Week 1<\/dd>/);
    const unknown = render({ snapshot: snapshot({}, { unknownSettings: ["seedingTiebreaker"] }), notes: [] });
    expect(unknown).toMatch(/<dt[^>]*>Ties in the standings<\/dt><dd class="[^"]*text-warn-fg[^"]*">Unknown \(points for assumed\)<\/dd>/);
    expect(unknown).toMatch(/<dt[^>]*>Final scores<\/dt><dd[^>]*>None yet<\/dd>/);
  });

  it("lists a per-unit rate on a sum of stats with the other rates", () => {
    const html = render({ snapshot: snapshot(), notes: [] });
    expect(html).toMatch(/<td[^>]*>Field goals made \(0–39 yds\)<\/td><td[^>]*>3<\/td>/);
    expect(html).toContain("Bonuses and special rules");
  });

  describe("the data card", () => {
    const refresh: RefreshControl = { onRefresh: noop, refreshing: false, error: null, status: null };

    it("offers Forget for this browser session's ESPN cookies, with an always-mounted status line", () => {
      const forget: ForgetControl = { onForget: noop, forgetting: false, done: false, note: null };
      const html = render({ snapshot: snapshot(), notes: [], usedEspnCookies: true, espnCookieSource: "session" }, {}, { refresh, forget });
      expect(html).toContain("Imported with your ESPN cookies from this browser session.");
      expect(html).toContain("Forget my ESPN cookies</button>");
      // Two always-mounted status lines: Forget's and Refresh's.
      expect(html.match(/role="status"/g)).toHaveLength(2);
    });

    it("keeps Refresh focusable while it works: aria-disabled, never disabled (review UI-9)", () => {
      const idle = render({ snapshot: snapshot(), notes: [] }, {}, { refresh });
      expect(idle).toMatch(/<button type="button"[^>]*>Refresh league data<\/button>/);
      expect(idle).not.toMatch(/aria-disabled="true"[^>]*>Refresh league data/);
      const busy = render({ snapshot: snapshot(), notes: [] }, {}, { refresh: { ...refresh, refreshing: true } });
      expect(busy).toMatch(/<button type="button" aria-disabled="true"[^>]*>Refreshing…<\/button>/);
      expect(busy).not.toMatch(/<button[^>]*disabled=""[^>]*>Refreshing…/);
    });

    it("replaces the Forget button with the confirmation", () => {
      const forget: ForgetControl = { onForget: noop, forgetting: false, done: true, note: "Done. Your ESPN cookies are gone from this browser session." };
      const html = render({ snapshot: snapshot(), notes: [], usedEspnCookies: true, espnCookieSource: "session" }, {}, { refresh, forget });
      expect(html).not.toContain("Forget my ESPN cookies</button>");
      expect(html).toMatch(/role="status" tabindex="-1"[^>]*>Done\. Your ESPN cookies are gone/);
    });

    it("credits .env.local for development cookies, with nothing to forget", () => {
      const html = render({ snapshot: snapshot(), notes: [], usedEspnCookies: true, espnCookieSource: "dev-env" }, {}, { refresh });
      expect(html).toContain("Imported with ESPN cookies from .env.local (USE_ENV_COOKIES=1, development only).");
      expect(html).not.toContain("from this browser session");
      expect(html).not.toContain("Forget my ESPN cookies");
    });

    it("announces what Refresh did", () => {
      const html = render({ snapshot: snapshot(), notes: [] }, {}, { refresh: { ...refresh, status: "Already up to date (fetched 12 s ago; Refresh works once a minute)" } });
      expect(html).toMatch(/role="status"[^>]*>Already up to date \(fetched 12 s ago; Refresh works once a minute\)</);
      expect(html).toContain("Our server keeps a copy of league data for about 10 minutes");
    });
  });
});
