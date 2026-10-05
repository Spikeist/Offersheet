/**
 * The footer (CLAUDE.md §14 "Footer and layout"; planner reply to Checkpoint 4c, B3: "a feedback link, the attributions
 * (FantasyCalc wherever values show), and 'Not affiliated with ESPN or Sleeper…'"). Static render.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ESPN_READS_BASE } from "@/adapters/espn/fetch";
import { nflScheduleUrl } from "@/data/nflSchedule";
import { FOOTER_CREDITS, FOOTER_INDEPENDENT, SiteFooter } from "./SiteFooter";

const html = renderToStaticMarkup(createElement(SiteFooter));
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

function links(markup: string) {
  return [...markup.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: /href="([^"]*)"/.exec(attrs)?.[1],
    classes: (/class="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/),
    attrs,
    text: inner.replace(/<[^>]+>/g, "").trim(),
  }));
}

describe("SiteFooter", () => {
  it("links Feedback, Privacy and Terms in a labeled row, each a 44 px tap target", () => {
    const nav = /<nav aria-label="About Offer Sheet">([\s\S]*?)<\/nav>/.exec(html)?.[1];
    if (nav === undefined) throw new Error("no footer nav");
    const row = links(nav);
    expect(row.map((l) => [l.href, l.text])).toEqual([
      ["/feedback", "Feedback"],
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
    ]);
    for (const l of row) expect(l.classes).toContain("min-h-11");
    // The dots between them are decoration only.
    expect(nav.match(/<span aria-hidden="true" class="px-0.5">·<\/span>/g)).toHaveLength(2);
  });

  it("credits FantasyCalc with a link (its terms ask for one wherever values show), opened safely in a new tab", () => {
    const fc = links(html).find((l) => l.href === "https://fantasycalc.com");
    expect(fc?.text).toBe("FantasyCalc");
    expect(fc?.attrs).toContain('target="_blank"');
    expect(fc?.attrs).toContain('rel="noopener noreferrer"');
    expect(text).toContain("Trade values: FantasyCalc");
  });

  it("credits the other sources and says Offer Sheet is a free, independent beta affiliated with none of them", () => {
    expect(FOOTER_CREDITS).toBe("Projections and stats: Sleeper and ESPN · Player IDs: DynastyProcess · NFL schedule: ESPN");
    expect(text).toContain(FOOTER_CREDITS);
    expect(FOOTER_INDEPENDENT).toBe(
      "Offer Sheet is a free, independent beta. It is not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc or the NFL.",
    );
    expect(text).toContain(FOOTER_INDEPENDENT);
    expect(text).toContain("© 2026 Offer Sheet");
  });

  it("credits the NFL schedule to ESPN, where the app reads it, not to nflverse, which it never downloads (review PG-2)", () => {
    expect(nflScheduleUrl(2026).startsWith(`${ESPN_READS_BASE}/`)).toBe(true);
    expect(text).toContain("NFL schedule: ESPN");
    expect(text).not.toContain("nflverse");
  });

  it("has no Yahoo attribution yet: it joins only where Yahoo data shows (Phase 5)", () => {
    expect(text).not.toContain("Fantasy data provided by Yahoo");
  });
});
