/**
 * The League page's best trade partners link to the Trade Finder for that team (Phase 4 wave 2 decision M13): one
 * 44 px link per card, named for screen readers by the team, carrying only the team's id. Static render of the
 * fictional league (every name made up).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildLeagueView } from "@/lib/leagueView";
import { NOW, leagueFixture } from "./testFixtures";
import { TradePartners } from "./TradePartners";

const render = (myTeamId: string | null = "1") => {
  const f = leagueFixture({ myTeamId });
  const view = buildLeagueView({ ...f, myTeamSource: "platform", timeZone: "America/Chicago", now: NOW });
  return renderToStaticMarkup(createElement(TradePartners, { view }));
};

describe("TradePartners → Trade Finder", () => {
  it("links each partner card to the Trade Finder with that team picked", () => {
    const html = render();
    const links = [...html.matchAll(/<a class="([^"]*)" href="([^"]*)">Trade ideas<span class="sr-only"> with ([^<]*)<\/span><\/a>/g)].map(([, cls = "", href, name]) => ({ href, name, target: cls.includes("min-h-11") }));
    expect(links).toEqual([
      { href: "/trades?partner=2", name: "Gravel Gophers", target: true },
      { href: "/trades?partner=3", name: "Quasar Quokkas", target: true },
      { href: "/trades?partner=4", name: "Tundra Tortoises", target: true },
    ]);
    expect(html).not.toContain("come in a later update");
    expect(html).toContain("“Trade ideas” opens the Trade Finder for that team: actual trades, ranked by how much they help you and how likely that team is to say yes.");
  });

  it("offers no links without partners (no team picked)", () => {
    expect(render(null)).not.toContain('href="/trades');
  });
});
