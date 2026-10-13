/**
 * The footer (CLAUDE.md §14 "Footer and layout"; planner reply to Checkpoint 4c, B3: "a feedback link, the attributions
 * (FantasyCalc wherever values show), and 'Not affiliated with ESPN or Sleeper…'"). Static render. Checkpoint 7b (planner
 * reply to Checkpoint 7a, 5.4): its FantasyCalc link carries FantasyCalc's attributes and is plain HTML in every page's
 * server render (the root layout around the page, usePathname mocked for the header). Checkpoint 7d (planner reply to
 * Checkpoint 7c, "Also"): the DynastyProcess credit links to its data repository, where the map's license is.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/league" }));

import { ESPN_READS_BASE } from "@/adapters/espn/fetch";
import { nflScheduleUrl } from "@/data/nflSchedule";
import { FANTASYCALC_LINK, FANTASYCALC_URL, ValuesCredit } from "./league/ValuesCredit";
import { DYNASTYPROCESS_LINK, DYNASTYPROCESS_URL, FOOTER_CREDITS, FOOTER_INDEPENDENT, SiteFooter } from "./SiteFooter";

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

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** FantasyCalc's attributes, in the order React writes them (it keeps referrerPolicy's case; HTML attribute names aren't case-sensitive). */
const FANTASYCALC_ATTRS = /^href="https:\/\/fantasycalc\.com" target="_blank" rel="noopener" referrerPolicy="origin" class="/;

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

  it("credits FantasyCalc with a link back, in a new tab, with FantasyCalc's attributes: noopener, no noreferrer or nofollow, only the origin as referrer (5.4)", () => {
    const fc = links(html).filter((l) => l.href === FANTASYCALC_URL);
    expect(fc.map((l) => l.text)).toEqual(["FantasyCalc"]);
    expect(fc[0]?.attrs).toMatch(FANTASYCALC_ATTRS);
    expect(fc[0]?.attrs).not.toMatch(/noreferrer|nofollow/);
    expect(text).toContain("Trade values: FantasyCalc");
    // The credit next to numbers on the League page, the Import Report and the trade cards carries the same attributes.
    expect(FANTASYCALC_LINK).toEqual({ href: "https://fantasycalc.com", target: "_blank", rel: "noopener", referrerPolicy: "origin" });
    const credit = links(renderToStaticMarkup(createElement(ValuesCredit)));
    expect(credit).toHaveLength(1);
    expect(credit[0]?.attrs).toMatch(FANTASYCALC_ATTRS);
  });

  it("is in every page's server HTML: the root layout, the only layout, is a server component that renders it after every page, its FantasyCalc link a plain <a> (5.4)", async () => {
    // Every page's layout is src/app/layout.tsx alone: no nested layout or template could leave the footer out.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/^(layout|template)\.[jt]sx?$/.test(e.name)) found.push(p);
      }
    };
    walk("src/app");
    expect(found).toEqual(["src/app/layout.tsx"]);
    // Server components: the layout, the footer and the module its link attributes come from (not loaded by JavaScript).
    for (const file of ["src/app/layout.tsx", "src/components/SiteFooter.tsx", "src/components/league/ValuesCredit.tsx"]) {
      expect(read(file), file).not.toMatch(/^\s*["']use client["']/m);
    }
    // The layout's render around a page, as the server sends it: the page, then the footer with the plain link.
    const { default: RootLayout } = await import("@/app/layout");
    const page = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "A page of Offer Sheet")));
    const fc = links(page).filter((l) => l.href === FANTASYCALC_URL);
    expect(fc).toHaveLength(1);
    expect(fc[0]?.attrs).toMatch(FANTASYCALC_ATTRS);
    expect(page.indexOf("A page of Offer Sheet")).toBeLessThan(page.indexOf('href="https://fantasycalc.com"'));
    expect(page.indexOf("<footer")).toBeGreaterThan(page.indexOf("A page of Offer Sheet"));
  });

  it("credits exactly the sources production uses and says Offer Sheet is a free, independent beta affiliated with none of them", () => {
    expect(FOOTER_CREDITS).toBe("Projections and stats: Sleeper and ESPN · Player IDs: DynastyProcess · NFL schedule: ESPN");
    expect(text).toContain(FOOTER_CREDITS);
    // DynastyProcess too, as the terms say (review POL-23: the footer credits its ID map).
    expect(FOOTER_INDEPENDENT).toBe(
      "Offer Sheet is a free, independent beta. It is not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.",
    );
    expect(text).toContain(FOOTER_INDEPENDENT);
    expect(text).toContain("© 2026 Offer Sheet");
  });

  it("links the DynastyProcess credit to its data repository, where the map's GPL-3.0 license is, in every page's server HTML: rel noopener, a new tab, inline in its sentence (planner reply to Checkpoint 7c, \"Also\"; security finding 10)", async () => {
    expect(DYNASTYPROCESS_URL).toBe("https://github.com/dynastyprocess/data");
    expect(DYNASTYPROCESS_LINK).toEqual({ href: DYNASTYPROCESS_URL, target: "_blank", rel: "noopener" });
    const dp = links(html).filter((l) => l.href === DYNASTYPROCESS_URL);
    expect(dp.map((l) => l.text)).toEqual(["DynastyProcess"]);
    expect(dp[0]?.attrs).toMatch(/^href="https:\/\/github\.com\/dynastyprocess\/data" target="_blank" rel="noopener" class="/);
    // No referrer policy of its own (the site's same-origin policy sends another site none), no noreferrer or nofollow.
    expect(dp[0]?.attrs).not.toMatch(/noreferrer|nofollow|referrerpolicy/i);
    // Inline in the credits' sentence, the same words as before: not a 44 px target (check:browser exempts a link inside a
    // sentence), nothing that would make it a box of its own.
    expect(dp[0]?.classes).not.toContain("min-h-11");
    expect(dp[0]?.classes.filter((c) => /^(inline-|block$|flex$|grid$)/.test(c))).toEqual([]);
    const credits = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1] ?? "").find((p) => p.includes(DYNASTYPROCESS_URL));
    expect(credits?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).toBe(FOOTER_CREDITS);
    // The root layout's render around a page: the link is in the server HTML, after the page, like FantasyCalc's.
    const { default: RootLayout } = await import("@/app/layout");
    const page = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "A page of Offer Sheet")));
    expect(links(page).filter((l) => l.href === DYNASTYPROCESS_URL).map((l) => l.text)).toEqual(["DynastyProcess"]);
    expect(page.indexOf(`href="${DYNASTYPROCESS_URL}"`)).toBeGreaterThan(page.indexOf("<footer"));
  });

  it("tells screen readers which links open a new tab, as ValuesCredit's link does: each one's name is its words and \" (opens in a new tab)\", the words it shows unchanged (review of Checkpoint 7d, PD7D-2)", async () => {
    const newTab = (markup: string) => links(markup).filter((l) => /\btarget="_blank"/.test(l.attrs));
    // FantasyCalc's and DynastyProcess's, the footer's only links to another site.
    expect(newTab(html).map((l) => l.href)).toEqual([FANTASYCALC_URL, DYNASTYPROCESS_URL]);
    expect(links(html).filter((l) => /^https?:/.test(l.href ?? "")).map((l) => l.href)).toEqual([FANTASYCALC_URL, DYNASTYPROCESS_URL]);
    for (const l of newTab(html)) {
      expect(/\baria-label="([^"]*)"/.exec(l.attrs)?.[1], l.href).toBe(`${l.text} (opens in a new tab)`);
      // The words shown are the link's own (check:browser's DynastyProcess step wants exactly "DynastyProcess").
      expect(l.text, l.href).toBe(l.href === FANTASYCALC_URL ? "FantasyCalc" : "DynastyProcess");
    }
    // The same words ValuesCredit's link reads out, there in a screen-reader-only span.
    expect(links(renderToStaticMarkup(createElement(ValuesCredit)))[0]?.text).toBe("Values: FantasyCalc (opens in a new tab)");
    // In every page's server HTML too.
    const { default: RootLayout } = await import("@/app/layout");
    const page = renderToStaticMarkup(createElement(RootLayout, null, createElement("p", null, "A page of Offer Sheet")));
    expect(newTab(page).map((l) => /\baria-label="([^"]*)"/.exec(l.attrs)?.[1])).toEqual(["FantasyCalc (opens in a new tab)", "DynastyProcess (opens in a new tab)"]);
  });

  it("credits the NFL schedule to ESPN, where the app reads it, not to nflverse, which it never downloads (review PG-2)", () => {
    expect(nflScheduleUrl(2026).startsWith(`${ESPN_READS_BASE}/`)).toBe(true);
    expect(text).toContain("NFL schedule: ESPN");
    expect(text).not.toContain("nflverse");
    // Nothing in the app's code downloads from nflverse (its games were Phase 0's cross-check, and test fixtures).
    const code: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/testSupport|test-helpers/.test(e.name)) code.push(read(p));
      }
    };
    walk("src");
    expect(code.filter((c) => /nflverse\/nfldata|nflverse-data|github\.com\/nflverse/i.test(c))).toEqual([]);
  });

  it("has no Yahoo attribution yet: it joins only where Yahoo data shows (Phase 5)", () => {
    expect(text).not.toContain("Fantasy data provided by Yahoo");
  });
});
