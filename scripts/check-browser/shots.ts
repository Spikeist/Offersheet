/**
 * The clutter check's screenshots (Checkpoint 7g; planner reply to Checkpoint 7f, item 5: "Parker wants to keep an eye on
 * whether the pages are getting too busy, so take screenshots at phone width (375 px) of: the Trade Finder with its first card
 * closed; the same card with everything on it opened; the League page; Waivers. Note anything that already looks crowded.
 * Don't redesign anything yet."). `npm run check:browser` takes four, into .cache/check-browser/shots/ with the other
 * screenshots, named so the report can use them (CLUTTER_SHOTS):
 * 1. clutter-1-trade-finder: the whole Trade Finder once every card's "now or after this week" number is in, the ideas in the
 *    order the page opens with (Overall in a fresh browser), nothing on any card opened. Taken at the start of the card step,
 *    before it presses anything (finderShot).
 * 2. clutter-2-trade-card-opened: the first card on its own with everything on it opened: "How to offer it" (its offers worked
 *    out) with each offer's message, its own message and its Plan B box's message. Those are every <details> the card has; its
 *    facts, roster moves and reasons always show. The card is scrolled into view first. Taken at the end of the card step,
 *    after its checks; the shot then closes what it opened and puts the page's scroll back (openedCardShot).
 * 3. clutter-3-league: the whole League page, its Waiver upgrades rated and on "Rest of season", nothing unfolded. Taken at the
 *    end of the Waivers step, after its checks: the League step itself leaves before the rating is in (leagueShots).
 * 4. clutter-4-waivers: the Waiver upgrades section on its own, at the same moment.
 *
 * How a shot is taken (captureParts):
 * - The page's league names are replaced by placeholders first (inPage.ts sanitizeCall, as for every screenshot). They're put
 *   back at the end, whatever happens.
 * - The region is measured: the whole page, or an element with SHOT_MARGIN of the page around it (SHOT_LAYOUT).
 * - It's cut into as few parts as fit in SHOT_PART_MAX CSS px each, as even in height as they can be, so the last one is never a
 *   sliver (planShotParts). A cut that would go through a line of text moves to the nearest gap above or below that line, as
 *   long as the part keeps at least SHOT_PART_MIN_SHARE of its even height.
 * - Each part is captured at the phone's width, one image pixel per CSS pixel (375 px wide), beyond the screen (Chrome's
 *   captureBeyondViewport). One part is "<name>.png"; several are "<name>-01.png", "<name>-02.png", and so on.
 * - Parts, not one tall image: no page is cut off (the full-page screenshots stop at 8,000 px), and each part reads at its own
 *   size, a little under two phone screens (an image viewer shrinks a 375 × 8,000 px image to a thin strip).
 * - Before the names are put back, the page's text is read once more. If it still holds a league name (report.ts
 *   leftoverChecker), the shot's images are deleted, never kept.
 * A shot that can't be taken is a skip, as for every screenshot: it's a record for a person to look at, not a check of the app.
 * --no-shots turns them off, and with them everything a shot does (opening the card, scrolling, waiting), so every step runs as
 * it did before. Each shot's numbers (its height in CSS px and in phone screens, and how many images) are noted with its
 * step's numbers ("clutterShots").
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OFFERS_LOADING_TEXT } from "@/lib/tradeView";
import { RESTORE_CALL, sanitizeCall } from "./inPage";
import { PHONE, type PageSession } from "./page";
import { LEAGUE_ID_PLACEHOLDER, leftoverChecker, nameRules, type CheckReport } from "./report";
import type { StepContext } from "./steps";

/** The four shots' names, as the report uses them. */
export const CLUTTER_SHOTS = {
  finder: "clutter-1-trade-finder",
  card: "clutter-2-trade-card-opened",
  league: "clutter-3-league",
  waivers: "clutter-4-waivers",
} as const;

/** The most a part is tall, in CSS px: a little under two phone screens (PHONE.height). */
export const SHOT_PART_MAX = 1_500;
/** A cut moves into a gap between lines only while the part keeps at least this share of its even height (planShotParts). */
export const SHOT_PART_MIN_SHARE = 0.6;
/** How far into a line's box a cut may go, in CSS px, without touching its letters (the line's leading). */
export const SHOT_LINE_GRACE = 2;
/** How much of the page shows around an element captured on its own, in CSS px. */
export const SHOT_MARGIN = 12;
/** The key of a step's numbers that lists its shots. */
export const CLUTTER_NOTE = "clutterShots";

/** How long one part's capture may take (a capture beyond the screen lays the whole page out). */
const CAPTURE_TIMEOUT_MS = 120_000;
/** A moment for the page to lay itself out again once its names are replaced. */
const SETTLE_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What SHOT_LAYOUT reads, in page coordinates (CSS px from the top of the page). */
export interface ShotLayout {
  /** The region to capture: from `top` to `bottom`. */
  top: number;
  bottom: number;
  /** The element's own height, without the margin around it; null for the whole page. */
  element: number | null;
  /** The page's own height. */
  page: number;
  /** Each line of text, and each control or image, in the region, as [top, bottom]. */
  spans: ReadonlyArray<readonly [number, number]>;
}

/** One part of a shot: its top in the page and its height, in whole CSS px. */
export interface ShotPart {
  y: number;
  height: number;
}

/**
 * Where a cut can't go (pure): each span shrunk by `grace` at both ends (a cut that close to a line's edge misses its letters),
 * the ones too short for that dropped, then sorted, and overlapping ones merged. Spans that only touch stay apart, so a cut can
 * fall between two lines of the same paragraph.
 */
export function blockedSpans(spans: ReadonlyArray<readonly [number, number]>, grace = SHOT_LINE_GRACE): Array<[number, number]> {
  const inner = spans
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .map(([a, b]): [number, number] => [Math.min(a, b) + grace, Math.max(a, b) - grace])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of inner) {
    const last = merged[merged.length - 1];
    if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/**
 * The parts a region is captured in (pure): from its top down, as few as fit in `max` CSS px each, as even in height as they can
 * be (so no part is a sliver: each cut aims at what's left divided by the parts it still needs). A cut that would go through a
 * line of text (blockedSpans) moves to the nearest gap, just above or just below that line, as long as the part keeps at least
 * `minShare` of its even height and stays within `max`; else it stays (a block of text taller than that has no gap to use). The
 * parts are in whole CSS px, one right after the other, each at most `max`, and cover the region exactly. None for an empty
 * region.
 */
export function planShotParts(layout: Pick<ShotLayout, "top" | "bottom" | "spans">, max = SHOT_PART_MAX, minShare = SHOT_PART_MIN_SHARE): ShotPart[] {
  const top = Math.max(0, Math.floor(layout.top));
  const bottom = Math.ceil(layout.bottom);
  const most = Math.floor(max);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top || !(most >= 1)) return [];
  const blocked = blockedSpans(layout.spans);
  const inside = (at: number) => blocked.find(([a, b]) => a < at && at < b) ?? null;
  const parts: ShotPart[] = [];
  let y = top;
  while (bottom - y > most) {
    const left = bottom - y;
    const even = Math.round(left / Math.ceil(left / most));
    const aim = y + even;
    let cut = aim;
    const hit = inside(aim);
    if (hit) {
      const least = y + Math.ceil(even * minShare);
      const gaps = [Math.floor(hit[0]), Math.ceil(hit[1])].filter((c) => c >= least && c <= y + most && !inside(c));
      // The nearer gap; the one above on a tie.
      if (gaps.length) cut = gaps.reduce((best, c) => (Math.abs(c - aim) < Math.abs(best - aim) ? c : best));
    }
    parts.push({ y, height: cut - y });
    y = cut;
  }
  parts.push({ y, height: bottom - y });
  return parts;
}

/** A part's file name (pure): "<name>.png" for a shot in one part, else "<name>-01.png", "<name>-02.png", … in order. */
export function shotPartFile(name: string, index: number, count: number): string {
  if (count <= 1) return `${name}.png`;
  return `${name}-${String(index + 1).padStart(Math.max(2, String(count).length), "0")}.png`;
}

/** A height in phone screens (PHONE.height), to one decimal (pure). */
export function phoneScreens(height: number): string {
  return (height / PHONE.height).toFixed(1);
}

const px = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * A shot's line among its step's numbers (pure): its name, what it shows, its height (the element's own, else the region's) in
 * CSS px and in phone screens, and how many images it took.
 */
export function clutterNote(name: string, what: string, layout: Pick<ShotLayout, "top" | "bottom" | "element">, images: number): string {
  const height = layout.element ?? layout.bottom - layout.top;
  return `${name}: ${what}; ${px(height)} px tall (${phoneScreens(height)} phone screens) in ${images === 1 ? "one image" : `${images} images`}`;
}

/** Why a shot wasn't kept, in fixed words fit to print (never page text). */
export class ShotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShotError";
  }
}

/** A league name was left on the page: the shot's images are deleted. */
export const NAMES_LEFT = "a league name was still on the page after the names were replaced, so its images were deleted";
/** The element a shot shows isn't on the page. */
export const TARGET_MISSING = "what it shows isn't on the page";
/** The region has no height. */
const NOTHING_TO_CAPTURE = "there was nothing to capture";

/** A skip line for a shot that wasn't kept (pure): a ShotError's words, else only the error's name (its message could quote the page). */
export function shotSkipText(name: string, err: unknown): string {
  if (err instanceof ShotError) return `the screenshot "${name}" wasn't kept: ${err.message}`;
  return `the screenshot "${name}" couldn't be saved (${err instanceof Error ? err.name : "error"}; --no-shots turns them off)`;
}

// ---------------------------------------------------------------------------------------------
// In the page (plain JavaScript: inPage.ts's rules; PAGE_HELPERS in scope, CARD_HELPERS where a call needs them)

/** The first trade card on the page, as the card step finds it. */
export const FIRST_CARD = `document.querySelector("article")`;
/** Waiver upgrades on the League page (src/lib/waiversView.ts WAIVERS_SECTION_ID). */
export const WAIVERS_SECTION = `document.getElementById("waivers")`;

/**
 * The region a shot captures and the spans its lines fill (a body for page.run; ShotLayout): `target`, an expression for an
 * element, with `margin` around it, or the whole page (null). An element that isn't there gives null. Coordinates are the page's
 * (the scroll added), each line of text one span (a Range's client rects), each control, image or icon one too, only what's
 * painted: Chrome lays out a closed <details>'s content when it's measured, as if it were open, so the League page's closed
 * roster cards once read as a long block of text in the way (Checkpoint 7g's second live run: a part of 933 px among parts of
 * about 1,420). checkVisibility() is false for that content, for display none and for visibility hidden (rendered(), from
 * PAGE_HELPERS, where a browser lacks it).
 */
export function shotLayoutCall(target: string | null, margin = 0): string {
  const m = Number.isFinite(margin) ? margin : 0;
  return String.raw`// shot:layout
const target = ${target ?? "null"};
const de = document.documentElement;
const pageHeight = Math.ceil(Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0));
const sy = window.scrollY;
let top = 0;
let bottom = pageHeight;
let element = null;
if (${target === null ? "false" : "true"}) {
  if (!target) return null;
  const r = target.getBoundingClientRect();
  element = Math.round(r.height);
  top = Math.max(0, r.top + sy - ${m});
  bottom = Math.min(pageHeight, r.bottom + sy + ${m});
}
const painted = new Map();
const renderCache = new Map();
const shown = (el) => {
  if (painted.has(el)) return painted.get(el);
  const v = typeof el.checkVisibility === "function" ? el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) : rendered(el, renderCache);
  painted.set(el, v);
  return v;
};
const spans = [];
const add = (r) => {
  if (r.width > 0 && r.height > 0 && r.bottom + sy > top && r.top + sy < bottom) spans.push([r.top + sy, r.bottom + sy]);
};
const range = document.createRange();
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
for (let n = walker.nextNode(); n; n = walker.nextNode()) {
  const p = n.parentElement;
  if (!p || !n.nodeValue || !n.nodeValue.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName) || !shown(p)) continue;
  range.selectNodeContents(n);
  for (const r of range.getClientRects()) add(r);
}
for (const el of document.body.querySelectorAll("button, input, select, textarea, img, svg, [role=progressbar]")) if (shown(el)) add(el.getBoundingClientRect());
return { top: top, bottom: bottom, element: element, page: pageHeight, spans: spans };`;
}

/** The page's text as shown, read while its names are replaced (captureParts checks it for a name left). */
export const SHOT_TEXT_CALL = String.raw`// shot:text
return document.body ? document.body.innerText || "" : "";`;

/**
 * The Trade Finder as shot 1 shows it: how many cards, how far down the page the first one starts, its height and how many of its
 * parts are open, and the sort.
 */
export const FIRST_CARD_CALL = String.raw`// shot:first-card
const cards = [...document.querySelectorAll("main article")];
const a = cards[0] || null;
const r = a ? a.getBoundingClientRect() : null;
const sort = document.getElementById("finder-sort");
return {
  cards: cards.length,
  top: r ? Math.round(r.top + window.scrollY) : null,
  height: r ? Math.round(r.height) : null,
  open: a ? [...a.querySelectorAll("details")].filter((d) => d.open).length : 0,
  sort: sort && sort.selectedIndex >= 0 ? txt(sort.options[sort.selectedIndex]) : null,
};`;

/**
 * Opens the first card's "How to offer it" when it's closed (its open state is the card's: React follows the toggle and asks
 * for the offers), keeping what it opened for CLOSE_OPENED_CALL; and the page's scroll, to put back (needs CARD_HELPERS).
 */
export const OPEN_OFFERS_CALL = String.raw`// shot:open-offers
window.__checkOpened = [];
const a = ${FIRST_CARD};
const x = window.scrollX;
const y = window.scrollY;
if (!a) return { found: false, offers: false, x: x, y: y };
const d = offersDetails(a);
if (d && !d.open) {
  d.open = true;
  window.__checkOpened.push(d);
}
return { found: true, offers: !!d, x: x, y: y };`;

/** The first card's offers worked out, or failed, or none to work out (a waitFor expression; CARD_HELPERS). */
export const OFFERS_SETTLED =
  String.raw`(() => { const a = ${FIRST_CARD}; const o = a ? offersData(a) : null; if (!o) return true; return o.offers.length > 0 || o.failed || (o.status !== "" && o.status !== ` +
  JSON.stringify(OFFERS_LOADING_TEXT) +
  String.raw`) ? true : null; })()`;

/**
 * Opens every <details> on the first card still closed, keeping which for CLOSE_OPENED_CALL: how many it has, how many the shot
 * opened, and whether the card has a Plan B box (needs CARD_HELPERS).
 */
export const OPEN_ALL_CALL = String.raw`// shot:open-all
const a = ${FIRST_CARD};
if (!a) return { total: 0, opened: 0, planB: false };
const list = window.__checkOpened || (window.__checkOpened = []);
const all = [...a.querySelectorAll("details")];
for (const d of all) {
  if (!d.open) {
    d.open = true;
    list.push(d);
  }
}
return { total: all.length, opened: list.length, planB: !!planBBox(a) };`;

/** No Copy button on the first card says "Copied!" (it goes back after 2.5 s: CopyButton.tsx): a waitFor expression. */
export const NO_COPIED = String.raw`(() => { const a = ${FIRST_CARD}; return !a || ![...a.querySelectorAll("button")].some((b) => txt(b) === "Copied!") ? true : null; })()`;

/** The first card scrolled to the top of the screen ("the page scrolled so the card is in view"). */
export const CARD_INTO_VIEW = String.raw`const a = ${FIRST_CARD};
if (a) a.scrollIntoView({ block: "start" });
await sleep(300);
return true;`;

/** Closes what OPEN_OFFERS_CALL and OPEN_ALL_CALL opened, innermost last opened first; how many. */
export const CLOSE_OPENED_CALL = String.raw`// shot:close
const list = window.__checkOpened || [];
for (const d of list.slice().reverse()) if (d.isConnected && d.open) d.open = false;
window.__checkOpened = null;
return list.length;`;

/** Puts the page's scroll back. */
export function scrollToCall(x: number, y: number): string {
  return `window.scrollTo(${Number.isFinite(x) ? x : 0}, ${Number.isFinite(y) ? y : 0}); return true;`;
}

// ---------------------------------------------------------------------------------------------
// Taking a shot

/** What a shot reads and captures through: PageSession's run and send (a fake one in the tests). */
export type ShotPage = Pick<PageSession, "run" | "send">;

export interface CaptureOptions {
  /** inPage.ts sanitizeCall's body: the league's names replaced before the shot, put back after it. */
  sanitize: string;
  /** An expression for the element to capture on its own, with `margin` around it; null: the whole page. */
  target: string | null;
  margin?: number;
  /** Whether the page's text, read with its names replaced, is free of league names: false deletes the images (ShotError NAMES_LEFT). */
  clean: (text: string) => boolean;
  /** The most a part is tall (SHOT_PART_MAX). */
  max?: number;
}

export interface CapturedShot {
  files: string[];
  layout: ShotLayout;
  parts: ShotPart[];
}

/**
 * Captures a region of the page in parts (the file header), into `dir` as `name` (shotPartFile): names replaced, the region
 * measured and cut, each part captured, the page's text checked for a name left, the names put back. Any failure deletes the
 * images it wrote and rethrows; the names are put back whatever happens.
 */
export async function captureParts(page: ShotPage, dir: string, name: string, opts: CaptureOptions): Promise<CapturedShot> {
  const files: string[] = [];
  try {
    await page.run(opts.sanitize);
    await sleep(SETTLE_MS);
    const layout = await page.run<ShotLayout | null>(shotLayoutCall(opts.target, opts.margin ?? 0));
    if (!layout) throw new ShotError(TARGET_MISSING);
    const parts = planShotParts(layout, opts.max ?? SHOT_PART_MAX);
    if (!parts.length) throw new ShotError(NOTHING_TO_CAPTURE);
    mkdirSync(dir, { recursive: true });
    for (const [i, part] of parts.entries()) {
      // One image px per CSS px: the device pixel ratio is 2, so the half scale gives a 375 px wide image (page.ts screenshots).
      const shot = await page.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: true, clip: { x: 0, y: part.y, width: PHONE.width, height: part.height, scale: 1 / PHONE.deviceScaleFactor } },
        CAPTURE_TIMEOUT_MS,
      );
      const file = path.join(dir, shotPartFile(name, i, parts.length));
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      files.push(file);
    }
    if (!opts.clean(await page.run<string>(SHOT_TEXT_CALL))) throw new ShotError(NAMES_LEFT);
    return { files, layout, parts };
  } catch (err) {
    for (const f of files) rmSync(f, { force: true });
    throw err;
  } finally {
    await page.run(RESTORE_CALL).catch(() => undefined);
  }
}

/** Adds a shot's line to its step's numbers (CLUTTER_NOTE), after the ones already there. */
export function noteShot(report: CheckReport, step: string, line: string): void {
  const before = report.numbers[step]?.[CLUTTER_NOTE];
  report.note(step, CLUTTER_NOTE, [...(Array.isArray(before) ? (before as string[]) : []), line]);
}

/**
 * Takes one shot for a step (captureParts) with the run's cleaning (report.ts: the names replaced, then checked by the
 * independent leftoverChecker): its images listed with the run's screenshots and its line noted, or a skip saying why not.
 * Nothing without a shots folder (--no-shots). True when it was kept.
 */
export async function takeShot(ctx: StepContext, step: string, name: string, what: string, target: string | null): Promise<boolean> {
  if (!ctx.shotsDir) return false;
  const leftovers = leftoverChecker(ctx.names, [ctx.leagueId]);
  try {
    const shot = await captureParts(ctx.page, ctx.shotsDir, name, {
      sanitize: sanitizeCall(nameRules(ctx.names, [[ctx.leagueId, LEAGUE_ID_PLACEHOLDER]])),
      target,
      margin: target === null ? 0 : SHOT_MARGIN,
      clean: (text) => leftovers(text) === 0,
    });
    ctx.shots.push(...shot.files);
    noteShot(ctx.report, step, clutterNote(name, what, shot.layout, shot.parts.length));
    return true;
  } catch (err) {
    ctx.report.skip(step, shotSkipText(name, err));
    return false;
  }
}

/** What FIRST_CARD_CALL reads. */
export interface FirstCardRead {
  cards: number;
  /** How far down the page the first card starts, in CSS px. */
  top: number | null;
  height: number | null;
  open: number;
  sort: string | null;
}

/** Shot 1's words (pure): the ideas shown and their sort, then where the first card starts and its height, closed. */
export function finderWhat(r: FirstCardRead | null): string {
  if (!r || !r.cards) return "the whole Trade Finder";
  const ideas = `${r.cards} ${r.cards === 1 ? "idea" : "ideas"}${r.sort ? ` sorted by ${r.sort}` : ""}`;
  const where = [r.top === null ? null : `starting ${px(r.top)} px down`, r.height === null ? null : `${px(r.height)} px tall`].filter((x): x is string => x !== null);
  const first = where.length ? `, the first ${where.join(" and ")}, ${r.open ? `${r.open} of its parts open` : "nothing on it opened"}` : "";
  return `the whole Trade Finder (${ideas}${first})`;
}

/** What OPEN_ALL_CALL reads. */
export interface OpenAllRead {
  total: number;
  opened: number;
  planB: boolean;
}

/** Shot 2's words (pure): how many of the card's disclosures show open, how many the shot opened itself, and a missing Plan B box. */
export function cardWhat(open: OpenAllRead | null, offersSettled: boolean): string {
  const said = [
    open ? `all ${open.total} of its disclosures, ${open.opened} of them opened for the shot` : null,
    open && !open.planB ? "no Plan B box on it" : null,
    offersSettled ? null : "its offers still being worked out",
  ].filter((x): x is string => x !== null);
  return `the first card on its own, everything on it opened${said.length ? ` (${said.join("; ")})` : ""}`;
}

/**
 * Shot 1 (the file header), at the start of the card step: the whole Trade Finder, nothing on any card opened. Nothing without a
 * shots folder.
 */
export async function finderShot(ctx: StepContext, step: string): Promise<void> {
  if (!ctx.shotsDir) return;
  const first = await ctx.page.run<FirstCardRead>(FIRST_CARD_CALL).catch(() => null);
  await takeShot(ctx, step, CLUTTER_SHOTS.finder, finderWhat(first), null);
}

/**
 * Shot 2 (the file header), at the end of the card step: the first card with everything on it opened, scrolled into view. What
 * the shot opened is closed again and the page's scroll put back, so the steps after it see the page as the card step left it.
 * Nothing without a shots folder.
 */
export async function openedCardShot(ctx: StepContext, step: string): Promise<void> {
  if (!ctx.shotsDir) return;
  const { page } = ctx;
  let at: { found: boolean; offers: boolean; x: number; y: number } | null = null;
  try {
    at = await page.run<{ found: boolean; offers: boolean; x: number; y: number }>(OPEN_OFFERS_CALL, { cards: true });
    if (!at.found) {
      ctx.report.skip(step, shotSkipText(CLUTTER_SHOTS.card, new ShotError(TARGET_MISSING)));
      return;
    }
    const settled = at.offers ? await page.waitFor<boolean>(OFFERS_SETTLED, 30_000, "the first card's offers", 100).catch(() => false) : true;
    const open = await page.run<OpenAllRead>(OPEN_ALL_CALL, { cards: true }).catch(() => null);
    await page.waitFor<boolean>(NO_COPIED, 5_000, "the first card's Copy buttons", 100).catch(() => false);
    await page.run(CARD_INTO_VIEW);
    await takeShot(ctx, step, CLUTTER_SHOTS.card, cardWhat(open, settled), FIRST_CARD);
  } catch (err) {
    // Opening the card or scrolling failed (takeShot says its own failures): a skip, as for every screenshot.
    ctx.report.skip(step, shotSkipText(CLUTTER_SHOTS.card, err));
  } finally {
    await page.run(CLOSE_OPENED_CALL).catch(() => undefined);
    if (at) await page.run(scrollToCall(at.x, at.y)).catch(() => undefined);
  }
}

/** Shots 3 and 4 (the file header), at the end of the Waivers step: the whole League page, then Waiver upgrades on its own. */
export async function leagueShots(ctx: StepContext, step: string): Promise<void> {
  if (!ctx.shotsDir) return;
  await takeShot(ctx, step, CLUTTER_SHOTS.league, "the whole League page", null);
  await takeShot(ctx, step, CLUTTER_SHOTS.waivers, "the Waiver upgrades section on its own", WAIVERS_SECTION);
}
