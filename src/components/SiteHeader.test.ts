/**
 * The site header (CLAUDE.md §14: mobile-first at 375 px): the main nav in the order you use the
 * pages (the Trade Finder after the League page: Phase 4 wave 2), then Settings (§14 item 6), the page
 * you're on marked for screen readers (aria-current) and visibly, 44 px targets, and a phone layout
 * that wraps rather than overflows, with a shorter "Report" label and tighter links below sm so the
 * five links keep one row at 375 px. Phase 4c: the league switcher sits next to the logo (LeagueSwitcher.test.ts),
 * the nav on a row of its own below lg. Part B: a "Beta" pill next to the logo, set tight below sm so the switcher keeps
 * the first row on a 320 px phone (review PG-4; check:browser measures it with the real switcher). Static render (first
 * render only), with usePathname mocked.
 */
import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

import { NavLink, navCurrent } from "./NavLink";
import { SiteHeader } from "./SiteHeader";

/** Every link in some markup: where it goes, its aria-current, its classes and its text. */
function links(html: string) {
  return [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs = "", inner = ""]) => ({
    href: /href="([^"]*)"/.exec(attrs)?.[1],
    current: /aria-current="([^"]*)"/.exec(attrs)?.[1],
    classes: (/class="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/),
    inner,
    text: inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  }));
}

function headerAt(pathname: string | null) {
  route.pathname = pathname;
  return renderToStaticMarkup(createElement(SiteHeader));
}

/** The links inside the main nav. */
function navLinks(html: string) {
  const nav = /<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  if (nav === undefined) throw new Error("no main nav");
  return links(nav);
}

describe("navCurrent", () => {
  it("marks the link to this page as the page", () => {
    expect(navCurrent("/league", "/league")).toBe("page");
    expect(navCurrent("/", "/")).toBe("page");
    expect(navCurrent("/league/", "/league")).toBe("page");
  });

  it("marks a section link while you're on a page under it", () => {
    expect(navCurrent("/league/team", "/league")).toBe("true");
    expect(navCurrent("/league/team/3", "/league/")).toBe("true");
  });

  it("counts whole path segments, and the home link only on the home page", () => {
    expect(navCurrent("/leagues", "/league")).toBeUndefined();
    expect(navCurrent("/import", "/league")).toBeUndefined();
    expect(navCurrent("/league", "/")).toBeUndefined();
  });

  it("marks nothing when the path isn't known", () => {
    expect(navCurrent(null, "/league")).toBeUndefined();
    expect(navCurrent(undefined, "/league")).toBeUndefined();
    expect(navCurrent("", "/league")).toBeUndefined();
  });
});

describe("NavLink", () => {
  function leagueLinkAt(pathname: string) {
    route.pathname = pathname;
    const props: ComponentProps<typeof NavLink> = { href: "/league", children: "League" };
    const [link] = links(renderToStaticMarkup(createElement(NavLink, props)));
    return link;
  }

  it("marks the current page with aria-current and a visible marker that isn't color alone", () => {
    const link = leagueLinkAt("/league");
    expect(link?.current).toBe("page");
    expect(link?.classes).toEqual(expect.arrayContaining(["bg-white/10", "underline", "decoration-accent", "decoration-2"]));
  });

  it("marks a section link as current while you're on a page under it", () => {
    expect(leagueLinkAt("/league/team")?.current).toBe("true");
  });

  it("leaves other pages' links unmarked", () => {
    const link = leagueLinkAt("/connect");
    expect(link?.current).toBeUndefined();
    expect(link?.classes).not.toContain("underline");
    expect(link?.text).toBe("League");
  });
});

describe("SiteHeader", () => {
  it("links Connect, Import report, League and Trades, in the order you use them, then Settings", () => {
    const nav = navLinks(headerAt("/"));
    expect(nav.map((l) => l.href)).toEqual(["/connect", "/import", "/league", "/trades", "/settings"]);
    expect(nav.map((l) => l.text)).toEqual(["Connect", "Report Import report", "League", "Trades", "Settings"]);
  });

  it("says 'Report' on phones and 'Import report' from sm up: only one shows, so it's the link's name", () => {
    const report = navLinks(headerAt("/")).find((l) => l.href === "/import");
    expect(report?.inner).toBe('<span class="sm:hidden">Report</span><span class="hidden sm:inline">Import report</span>');
  });

  it.each([
    ["/connect", "/connect"],
    ["/import", "/import"],
    ["/league", "/league"],
    ["/trades", "/trades"],
    ["/settings", "/settings"],
  ])("on %s, marks only that page's link as current", (pathname, href) => {
    const nav = navLinks(headerAt(pathname));
    expect(nav.filter((l) => l.current).map((l) => [l.href, l.current])).toEqual([[href, "page"]]);
  });

  it("marks no nav link on pages outside the nav (home, privacy)", () => {
    for (const pathname of ["/", "/privacy"]) expect(navLinks(headerAt(pathname)).some((l) => l.current)).toBe(false);
  });

  it("marks Trades as the current section on the Trade Analyzer (reached from the Trade Finder), not as the page", () => {
    for (const pathname of ["/analyzer", "/analyzer/"]) {
      const nav = navLinks(headerAt(pathname));
      expect(nav.filter((l) => l.current).map((l) => [l.href, l.current])).toEqual([["/trades", "true"]]);
      expect(nav.find((l) => l.href === "/trades")?.classes).toEqual(expect.arrayContaining(["underline", "decoration-accent"]));
    }
    expect(navLinks(headerAt("/analyzers")).some((l) => l.current)).toBe(false);
  });

  it("keeps 'Offer Sheet' as the home link's name while phones show only the mark", () => {
    const home = links(headerAt("/")).find((l) => l.href === "/");
    expect(home?.text).toBe("Offer Sheet");
    expect(home?.inner).toMatch(/^<svg viewBox="0 0 32 32" aria-hidden="true"/);
    expect(home?.inner).toContain('<span class="sr-only text-lg sm:not-sr-only">Offer Sheet</span>');
  });

  it("shows a 'Beta' pill next to the logo, a visible word outside the home link, so the link's name stays 'Offer Sheet' (Part B, B3)", () => {
    const html = headerAt("/");
    expect(links(html).find((l) => l.href === "/")?.text).toBe("Offer Sheet");
    const pill = /<\/a><span class="([^"]*)">Beta<\/span><\/div>/.exec(html)?.[1]?.split(" ");
    if (!pill) throw new Error("no Beta pill right after the home link");
    expect(pill).not.toContain("sr-only");
    expect(pill).toEqual(expect.arrayContaining(["border", "text-accent", "rounded-full"]));
    // The logo and the pill stay together, in a group that doesn't shrink.
    expect(html).toMatch(/<div class="flex shrink-0 items-center sm:gap-1\.5"><a class="[^"]*" href="\/">/);
  });

  it("sets the logo, the pill and the row tight below sm, so the league switcher stays on their row on a 320 px phone (review PG-4)", () => {
    const html = headerAt("/");
    const row = /<header class="bg-navy text-navy-contrast"><div class="([^"]*)">/.exec(html)?.[1]?.split(" ") ?? [];
    expect(row).toEqual(expect.arrayContaining(["gap-x-2", "sm:gap-x-3", "px-4"]));
    expect(row).not.toContain("gap-x-3");
    // No space in the group below sm but the home link's own 6 px padding; from sm up, as before.
    const group = /<div class="(flex shrink-0 items-center[^"]*)"><a /.exec(html)?.[1]?.split(" ");
    expect(group).toEqual(["flex", "shrink-0", "items-center", "sm:gap-1.5"]);
    const pill = /<span class="([^"]*)">Beta<\/span>/.exec(html)?.[1]?.split(" ") ?? [];
    expect(pill).toEqual(expect.arrayContaining(["px-1", "sm:px-2", "border", "text-xs"]));
    expect(pill).not.toContain("px-2");
    const home = links(html).find((l) => l.href === "/")?.classes ?? [];
    expect(home).toEqual(expect.arrayContaining(["-ml-1.5", "px-1.5"]));

    // The budget, in CSS px (Tailwind's spacing unit is 4 px): a 320 px phone leaves 288 px inside the row's 16 px sides.
    // The home link: the 32 px mark plus 6 px each side, less its 6 px pull. The pill: its word (34 px in Chrome on
    // Windows: Segoe UI, the widest of the system fonts the site uses) plus 4 px each side and a 1 px border each side.
    // Then the row's 8 px gap and the switcher's basis (LeagueSwitcher.tsx, read from its classes).
    const basisRem = Number(/flex-\[1_1_(\d+(?:\.\d+)?)rem\]/.exec(readFileSync(new URL("./LeagueSwitcher.tsx", import.meta.url), "utf8"))?.[1]);
    expect(basisRem).toBeGreaterThan(0);
    const firstRow = 32 + 2 * 6 - 6 + (34 + 2 * 4 + 2) + 8 + basisRem * 16; // 282 with the 12rem basis
    expect(firstRow).toBeLessThanOrEqual(320 - 2 * 16 - 4); // a few px to spare for other fonts
  });

  it("gives every link a 44 px tap target", () => {
    const all = links(headerAt("/league"));
    expect(all).toHaveLength(6);
    for (const l of all) expect(l.classes).toContain("min-h-11");
  });

  it("sets the links closer together on phones so five fit one row at 375 px, and as before from sm up", () => {
    const html = headerAt("/");
    for (const l of navLinks(html)) expect(l.classes).toEqual(expect.arrayContaining(["px-2", "sm:px-2.5"]));
    const nav = /<nav aria-label="Main" class="([^"]*)">/.exec(html)?.[1]?.split(" ");
    expect(nav).toEqual(expect.arrayContaining(["gap-0.5", "sm:gap-1"]));
  });

  it("drops the nav to a second row rather than overflow on a narrow screen", () => {
    const html = headerAt("/");
    const row = /<header class="bg-navy text-navy-contrast"><div class="([^"]*)">/.exec(html)?.[1]?.split(" ");
    expect(row).toEqual(expect.arrayContaining(["flex", "flex-wrap", "justify-between"]));
    const nav = /<nav aria-label="Main" class="([^"]*)">/.exec(html)?.[1]?.split(" ");
    expect(nav).toEqual(expect.arrayContaining(["ml-auto", "flex", "flex-wrap"]));
  });

  it("gives the nav a row of its own below lg, with or without the league switcher, so the rows never move when it appears (Phase 4c)", () => {
    const html = headerAt("/");
    const nav = /<nav aria-label="Main" class="([^"]*)">/.exec(html)?.[1]?.split(" ");
    expect(nav).toEqual(expect.arrayContaining(["basis-full", "justify-end", "lg:basis-auto"]));
    // The header's row anchors the switcher's panel on phones.
    expect(/<header class="bg-navy text-navy-contrast"><div class="([^"]*)">/.exec(html)?.[1]?.split(" ")).toContain("relative");
  });

  it("renders no league switcher on the server (the league store is read in the browser), only its empty status line", () => {
    const html = headerAt("/league");
    expect(html).not.toContain("data-league-switcher");
    expect(html).toContain('<p role="status" class="sr-only"></p>');
    // The storage banner shows only once the store says leagues can't be kept.
    expect(html).not.toContain('role="alert"');
  });
});
