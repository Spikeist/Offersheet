/**
 * The site header (CLAUDE.md §14: mobile-first at 375 px): the main nav in the order you use the
 * pages, the page you're on marked for screen readers (aria-current) and visibly, 44 px targets, and
 * a phone layout that keeps the header on one row. Static render (first render only), with
 * usePathname mocked.
 */
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
  it("links Connect, Import report and League, in the order you use them", () => {
    const nav = navLinks(headerAt("/"));
    expect(nav.map((l) => [l.href, l.text])).toEqual([
      ["/connect", "Connect"],
      ["/import", "Import report"],
      ["/league", "League"],
    ]);
  });

  it.each([
    ["/connect", "/connect"],
    ["/import", "/import"],
    ["/league", "/league"],
  ])("on %s, marks only that page's link as current", (pathname, href) => {
    const nav = navLinks(headerAt(pathname));
    expect(nav.filter((l) => l.current).map((l) => [l.href, l.current])).toEqual([[href, "page"]]);
  });

  it("marks no nav link on pages outside the nav (home, privacy)", () => {
    for (const pathname of ["/", "/privacy"]) expect(navLinks(headerAt(pathname)).some((l) => l.current)).toBe(false);
  });

  it("keeps 'Offer Sheet' as the home link's name while phones show only the mark", () => {
    const home = links(headerAt("/")).find((l) => l.href === "/");
    expect(home?.text).toBe("Offer Sheet");
    expect(home?.inner).toMatch(/^<svg viewBox="0 0 32 32" aria-hidden="true"/);
    expect(home?.inner).toContain('<span class="sr-only text-lg sm:not-sr-only">Offer Sheet</span>');
  });

  it("gives every link a 44 px tap target", () => {
    const all = links(headerAt("/league"));
    expect(all).toHaveLength(4);
    for (const l of all) expect(l.classes).toContain("min-h-11");
  });

  it("drops the nav to a second row rather than overflow on a narrow screen", () => {
    const html = headerAt("/");
    const row = /<header class="bg-navy text-navy-contrast"><div class="([^"]*)">/.exec(html)?.[1]?.split(" ");
    expect(row).toEqual(expect.arrayContaining(["flex", "flex-wrap", "justify-between"]));
    const nav = /<nav aria-label="Main" class="([^"]*)">/.exec(html)?.[1]?.split(" ");
    expect(nav).toEqual(expect.arrayContaining(["ml-auto", "flex", "flex-wrap"]));
  });
});
