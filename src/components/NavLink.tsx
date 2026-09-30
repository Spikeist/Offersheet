"use client";
/**
 * A link in the site header's main nav that marks the page you're on (CLAUDE.md §14: the MVP's
 * pages, mobile-first). The link to this page gets aria-current="page"; a section link gets "true"
 * while you're on a page under it. Both also get a visible marker that isn't color alone (a tinted
 * pill with a gold underline). It's a client component because it reads the URL (usePathname), so
 * SiteHeader itself can stay a server component.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "./ui";

export type NavCurrent = "page" | "true";

/**
 * How the link `href` relates to the current `pathname`: "page" when it's this page, "true" when this
 * page is under it, undefined otherwise. Path segments count whole, so "/league" doesn't claim
 * "/leagues", and "/" only matches the home page itself.
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

/** A 44 px tall tap target on the navy header. */
const LINK = "inline-flex min-h-11 items-center rounded-lg px-2.5 hover:bg-white/10";
const CURRENT = "bg-white/10 underline decoration-accent decoration-2 underline-offset-4";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const current = navCurrent(usePathname(), href);
  return (
    <Link href={href} aria-current={current} className={cx(LINK, current && CURRENT)}>
      {children}
    </Link>
  );
}
