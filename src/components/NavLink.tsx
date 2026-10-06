"use client";
/**
 * A link in the site header's main nav that marks the page you're on (CLAUDE.md §14: the MVP's
 * pages, mobile-first). The link to this page gets aria-current="page"; a section link gets "true"
 * while you're on a page under it. Both also get a visible marker that isn't color alone (a tinted
 * pill with a gold underline). It's a client component because it reads the URL (usePathname), so
 * SiteHeader itself can stay a server component.
 *
 * A link to a section of the page you're on ("Waivers", /league#waivers, on the League page) is revealed here when the
 * section is there (revealSectionLink): Next doesn't scroll to a hash the address already ends in, so a second tap did
 * nothing, and it never moves keyboard focus on a hash link (review of the Waivers link). The section comes into view and
 * its heading takes focus; elsewhere (another page, or the League page still computing) the link navigates as usual and
 * the section reveals itself when it appears (WaiverUpgrades.tsx).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "./ui";

export type NavCurrent = "page" | "true";

/**
 * How the link `href` relates to the current `pathname`: "page" when it's this page, "true" when this
 * page is under it, undefined otherwise. Path segments count whole, so "/league" doesn't claim
 * "/leagues", and "/" only matches the home page itself. A link to a section of a page ("/league#waivers":
 * the League page's "Waiver upgrades", src/lib/waiversLink.ts) is never current: the page's own link is.
 */
export function navCurrent(pathname: string | null | undefined, href: string): NavCurrent | undefined {
  if (!pathname) return undefined;
  const path = withoutTrailingSlash(pathname);
  const target = withoutTrailingSlash(href);
  if (path === target) return "page";
  if (target !== "/" && path.startsWith(`${target}/`)) return "true";
  return undefined;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** The id of the section `href` names on the page at `pathname` ("/league#waivers" on /league: "waivers"), else null. */
export function samePageSection(href: string, pathname: string): string | null {
  const at = href.indexOf("#");
  if (at < 0) return null;
  const id = href.slice(at + 1);
  const path = href.slice(0, at) || pathname;
  return id && withoutTrailingSlash(path) === withoutTrailingSlash(pathname) ? id : null;
}

/** A section revealSection can bring into view (an HTMLElement in the browser; a fake in tests). */
export interface RevealableSection {
  scrollIntoView(arg?: ScrollIntoViewOptions): void;
  focus(options?: FocusOptions): void;
  /** Its first element matching `selectors`: what takes focus. */
  querySelector(selectors: string): { focus(options?: FocusOptions): void } | null;
}

/** The page a section link is clicked on (the browser's location, document and history; a fake in tests). */
export interface SectionPage {
  readonly pathname: string;
  readonly hash: string;
  getElementById(id: string): RevealableSection | null;
  /** Adds a history entry for `url`, as a hash link does (Next keeps its router in step with window.history.pushState). */
  pushState(url: string): void;
}

/**
 * Brings section `id` into view at the top of the screen and moves keyboard focus to its heading (its first element
 * focusable from script only, tabIndex −1: a CardTitle with a headingRef, ui.tsx FOCUS_TARGET), else the section itself,
 * without a second scroll (reveal.ts's rule); false when the section isn't on the page.
 */
export function revealSection(page: Pick<SectionPage, "getElementById">, id: string): boolean {
  const section = page.getElementById(id);
  if (!section) return false;
  section.scrollIntoView({ block: "start" });
  (section.querySelector('[tabindex="-1"]') ?? section).focus({ preventScroll: true });
  return true;
}

/**
 * A plain click on a nav link (Link's onNavigate: Next is about to navigate): a link to a section of this page that's on
 * it is revealed (revealSection), the address gaining the hash when it didn't end in it (one history entry, as a hash link
 * makes; none for a second tap). True when it did: the caller cancels Next's navigation then.
 */
export function revealSectionLink(href: string, page: SectionPage): boolean {
  const id = samePageSection(href, page.pathname);
  if (!id || !revealSection(page, id)) return false;
  if (page.hash !== `#${id}`) page.pushState(href);
  return true;
}

/** The browser's page (revealSectionLink, and a section revealing itself on arrival: WaiverUpgrades.tsx). Browser only. */
export function browserSectionPage(): SectionPage {
  return {
    pathname: window.location.pathname,
    hash: window.location.hash,
    getElementById: (id) => {
      const el = document.getElementById(id);
      return el
        ? {
            scrollIntoView: (arg) => el.scrollIntoView(arg),
            focus: (options) => el.focus(options),
            querySelector: (selectors) => el.querySelector<HTMLElement>(selectors),
          }
        : null;
    },
    pushState: (url) => window.history.pushState(null, "", url),
  };
}

/**
 * A 44 px tall tap target on the navy header (a little narrower on phones), its text centered in its cell of the phone
 * nav's three-column grid (SiteHeader.tsx).
 */
const LINK = "inline-flex min-h-11 items-center justify-center rounded-lg px-2 hover:bg-white/10 sm:px-2.5";
const CURRENT = "bg-white/10 underline decoration-accent decoration-2 underline-offset-4";

/**
 * `alsoOn`: other pages this link's section holds (the Trade Analyzer belongs to Trades): there it's marked "true",
 * like a page under it.
 */
export function NavLink({ href, children, alsoOn = [] }: { href: string; children: ReactNode; alsoOn?: readonly string[] }) {
  const pathname = usePathname();
  const current = navCurrent(pathname, href) ?? (alsoOn.some((path) => navCurrent(pathname, path)) ? "true" : undefined);
  return (
    <Link
      href={href}
      aria-current={current}
      className={cx(LINK, current && CURRENT)}
      onNavigate={(e) => {
        if (revealSectionLink(href, browserSectionPage())) e.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}
