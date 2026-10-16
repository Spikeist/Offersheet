/**
 * check:browser's clutter screenshots (Checkpoint 7g; planner reply to Checkpoint 7f, item 5; shots.ts): how a region is cut into
 * parts, the parts' names and the notes, the in-page JavaScript (a syntax check: TypeScript never sees it), and a shot taken
 * through a fake page: what it sends and in what order, the names always put back, and nothing kept when a league name is left
 * or a capture fails. The steps themselves need the production build and Chrome: the script is their test. Every name here is
 * fictional.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARD_HELPERS, PAGE_HELPERS, RESTORE_CALL } from "./inPage";
import { PHONE } from "./page";
import { CheckReport, type LeagueNames } from "./report";
import {
  blockedSpans,
  CARD_INTO_VIEW,
  captureParts,
  CLOSE_OPENED_CALL,
  CLUTTER_NOTE,
  CLUTTER_SHOTS,
  cardWhat,
  clutterNote,
  FIRST_CARD,
  FIRST_CARD_CALL,
  finderShot,
  finderWhat,
  leagueShots,
  NAMES_LEFT,
  NO_COPIED,
  OFFERS_SETTLED,
  OPEN_ALL_CALL,
  OPEN_OFFERS_CALL,
  openedCardShot,
  phoneScreens,
  planShotParts,
  scrollToCall,
  SHOT_LINE_GRACE,
  SHOT_MARGIN,
  SHOT_PART_MAX,
  SHOT_PART_MIN_SHARE,
  SHOT_TEXT_CALL,
  ShotError,
  shotLayoutCall,
  shotPartFile,
  shotSkipText,
  TARGET_MISSING,
  WAIVERS_SECTION,
  type ShotLayout,
  type ShotPage,
} from "./shots";
import type { StepContext } from "./steps";

/** The parts cover [top, bottom) exactly, one right after the other, each at most `max` tall, in whole px. */
function covers(parts: Array<{ y: number; height: number }>, top: number, bottom: number, max = SHOT_PART_MAX): boolean {
  let y = top;
  for (const p of parts) {
    if (p.y !== y || !Number.isInteger(p.y) || !Number.isInteger(p.height) || p.height <= 0 || p.height > max) return false;
    y += p.height;
  }
  return y === bottom;
}

describe("cutting a region into parts (planShotParts)", () => {
  it("the settings: parts a little under two phone screens, a cut moving up only while the part keeps 60% of that", () => {
    expect(SHOT_PART_MAX).toBeLessThan(2 * PHONE.height);
    expect(SHOT_PART_MAX).toBeGreaterThan(PHONE.height);
    expect(SHOT_PART_MIN_SHARE).toBe(0.6);
    expect(SHOT_LINE_GRACE).toBe(2);
  });

  it("a page shorter than a part is one part: the whole page", () => {
    expect(planShotParts({ top: 0, bottom: 1_200, spans: [] })).toEqual([{ y: 0, height: 1_200 }]);
    expect(planShotParts({ top: 0, bottom: SHOT_PART_MAX, spans: [] })).toEqual([{ y: 0, height: SHOT_PART_MAX }]);
  });

  it("a tall page is never cut off: as few parts as fit, as even in height as they can be, together the whole page", () => {
    const parts = planShotParts({ top: 0, bottom: 20_123, spans: [] });
    expect(parts).toHaveLength(14);
    const heights = parts.map((p) => p.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(3);
    expect(covers(parts, 0, 20_123)).toBe(true);
  });

  it("the last part is never a sliver: a region just over one part is two even halves", () => {
    // Checkpoint 7g's first live run: Waiver upgrades (1,536 px with its margin) came out as 1,443 px and 93 px.
    expect(planShotParts({ top: 0, bottom: 1_536, spans: [] })).toEqual([
      { y: 0, height: 768 },
      { y: 768, height: 768 },
    ]);
  });

  it("a cut through a line of text moves to the nearest gap, above or below that line", () => {
    // Three even parts of 3,200 px aim the first cut at 1,067. A line whose span less its top grace (SHOT_LINE_GRACE) runs from
    // 1,062.5 to 1,075.5: the gap above (1,062) is nearer than the one below (1,076).
    const above = planShotParts({ top: 0, bottom: 3_200, spans: [[1_060.5, 1_075.5]] });
    expect(above[0]).toEqual({ y: 0, height: 1_062 });
    expect(covers(above, 0, 3_200)).toBe(true);
    // From 1,054.5 to 1,069.5: the gap below (1,070, under the span's bottom) is the nearer one.
    const below = planShotParts({ top: 0, bottom: 3_200, spans: [[1_052.5, 1_069.5]] });
    expect(below[0]).toEqual({ y: 0, height: 1_070 });
    expect(covers(below, 0, 3_200)).toBe(true);
  });

  it("a cut moved below a line lands at or under its span's bottom, never in its descenders (review of Checkpoint 7g, shots-cut-into-descenders)", () => {
    // A span is the font's content area, whose descenders reach its bottom. The aim, 1,067, falls in the line's bottom 2 px
    // (it ends at 1,068.25): the cut moves under it, to 1,069. Until the review the bottom 2 px gave too, as if they were the
    // line's leading, and the cut stayed at 1,067: the tail of a "y" landed at the top of the next image.
    const tail = planShotParts({ top: 0, bottom: 3_200, spans: [[1_050.25, 1_068.25]] });
    expect(tail[0]).toEqual({ y: 0, height: 1_069 });
    // Lines at the app's sizes (spans of 16, 19 and 21 px in line boxes of 16, 20 and 24 px), wherever they fall against the
    // aims: no cut goes into a line past its top grace. A cut moved above lands at most SHOT_LINE_GRACE px into its top, one
    // moved below at or under its bottom.
    const into: string[] = [];
    for (const [span, box] of [
      [16, 16],
      [19, 20],
      [21, 24],
    ] as const) {
      for (let offset = 0; offset < box; offset += 0.25) {
        for (const bottom of [3_200, 4_600]) {
          const spans: Array<[number, number]> = [];
          for (let y = offset + (box - span) / 2; y + span <= bottom; y += box) spans.push([y, y + span]);
          const parts = planShotParts({ top: 0, bottom, spans });
          expect(covers(parts, 0, bottom), `${span}/${box} at ${offset}`).toBe(true);
          for (const { y: cut } of parts.slice(1)) {
            for (const [a, b] of spans) if (a + SHOT_LINE_GRACE < cut && cut < b) into.push(`${span}/${box} at ${offset}, ${bottom} px: a cut at ${cut} in [${a}, ${b}]`);
          }
        }
      }
    }
    expect(into).toEqual([]);
    // A large font's spans overlap (40 px in 36 px lines): they merge into one block, which the cut goes around.
    const big: Array<[number, number]> = Array.from({ length: 8 }, (_, k): [number, number] => [998 + 36 * k, 1_038 + 36 * k]);
    expect(blockedSpans(big)).toEqual([[1_000, 1_290]]);
    expect(planShotParts({ top: 0, bottom: 3_200, spans: big })[0]).toEqual({ y: 0, height: 1_000 });
  });

  it("a cut moves only while the part keeps SHOT_PART_MIN_SHARE of its even height and stays within SHOT_PART_MAX; a block taller than that is cut", () => {
    // One block from 802 to 1,705 px (spans overlapping each other by more than the grace, so they merge), and two even parts
    // of 3,000 px aiming at 1,500: the gap above is too high up (under 60% of 1,500) and the one below past 1,500.
    const block: Array<[number, number]> = [];
    for (let y = 800; y < 1_700; y += 15) block.push([y, y + 20]);
    expect(planShotParts({ top: 0, bottom: 3_000, spans: block })[0]).toEqual({ y: 0, height: SHOT_PART_MAX });
    // The same block from 1,000 px: the gap above it keeps 60%, so the cut moves up to it.
    const lower = block.map(([a, b]): [number, number] => [a + 200, b + 200]);
    expect(planShotParts({ top: 0, bottom: 3_000, spans: lower })[0]).toEqual({ y: 0, height: 1_002 });
  });

  it("two lines that only touch leave room for a cut between them; a cut may go into a line's top grace, and a span no taller than the grace never stops one", () => {
    expect(planShotParts({ top: 0, bottom: 3_000, spans: [[1_480, 1_500], [1_500, 1_520]] })[0]).toEqual({ y: 0, height: 1_500 });
    // 1 px into the line's top, above its letters.
    expect(planShotParts({ top: 0, bottom: 3_000, spans: [[1_499, 1_510]] })[0]).toEqual({ y: 0, height: 1_500 });
    expect(planShotParts({ top: 0, bottom: 3_000, spans: [[1_498.5, 1_500.5]] })[0]).toEqual({ y: 0, height: 1_500 });
  });

  it("an element's region starts at its own top, in whole px, and is cut from there (a tie between two gaps goes to the one above)", () => {
    expect(planShotParts({ top: 5_000.4, bottom: 6_200.6, spans: [] })).toEqual([{ y: 5_000, height: 1_201 }]);
    // Three even parts of 4,000 px aim at 6,333; the line's gaps, 6,327 (2 px into its top) and 6,339 (under its bottom,
    // 6,338.5), are as near: the one above.
    const parts = planShotParts({ top: 5_000, bottom: 9_000, spans: [[6_325.5, 6_338.5]] });
    expect(parts[0]).toEqual({ y: 5_000, height: 1_327 });
    expect(covers(parts, 5_000, 9_000)).toBe(true);
  });

  it("nothing for an empty or broken region, or a part size under 1 px", () => {
    expect(planShotParts({ top: 100, bottom: 100, spans: [] })).toEqual([]);
    expect(planShotParts({ top: 200, bottom: 100, spans: [] })).toEqual([]);
    expect(planShotParts({ top: Number.NaN, bottom: 100, spans: [] })).toEqual([]);
    expect(planShotParts({ top: 0, bottom: 100, spans: [] }, 0)).toEqual([]);
  });

  it("where a cut can't go: lines with their top grace taken off and their bottoms kept (descenders reach them), merged where they overlap, kept apart where they only touch", () => {
    expect(blockedSpans([[30, 50], [10, 20], [45, 60], [60, 70], [80, 83], [90, 92], [Number.NaN, 5]])).toEqual([
      [12, 20],
      [32, 60],
      [62, 70],
      [82, 83],
    ]);
    // A span given bottom first counts the same.
    expect(blockedSpans([[50, 30]])).toEqual([[32, 50]]);
  });
});

describe("the shots' names and notes", () => {
  it("the four shots, as the report names them", () => {
    expect(Object.values(CLUTTER_SHOTS)).toEqual(["clutter-1-trade-finder", "clutter-2-trade-card-opened", "clutter-3-league", "clutter-4-waivers"]);
  });

  it("one part keeps the shot's name; several are numbered in order, zero-padded so they sort", () => {
    expect(shotPartFile("clutter-4-waivers", 0, 1)).toBe("clutter-4-waivers.png");
    expect(shotPartFile("clutter-3-league", 0, 9)).toBe("clutter-3-league-01.png");
    expect(shotPartFile("clutter-3-league", 9, 10)).toBe("clutter-3-league-10.png");
    expect(shotPartFile("clutter-3-league", 4, 120)).toBe("clutter-3-league-005.png");
  });

  it("a shot's line: what it shows, its height in px and in phone screens (the element's own, without the margin), and its images", () => {
    expect(phoneScreens(PHONE.height)).toBe("1.0");
    expect(clutterNote(CLUTTER_SHOTS.league, "the whole League page", { top: 0, bottom: 18_230, element: null }, 13)).toBe(
      "clutter-3-league: the whole League page; 18,230 px tall (22.5 phone screens) in 13 images",
    );
    expect(clutterNote(CLUTTER_SHOTS.waivers, "the Waiver upgrades section on its own", { top: 9_988, bottom: 11_212, element: 1_200 }, 1)).toBe(
      "clutter-4-waivers: the Waiver upgrades section on its own; 1,200 px tall (1.5 phone screens) in one image",
    );
  });

  it("shot 1's and shot 2's words", () => {
    expect(finderWhat({ cards: 13, top: 1_290, height: 1_436, open: 0, sort: "Overall" })).toBe(
      "the whole Trade Finder (13 ideas sorted by Overall, the first starting 1,290 px down and 1,436 px tall, nothing on it opened)",
    );
    expect(finderWhat({ cards: 1, top: null, height: 900, open: 2, sort: null })).toBe("the whole Trade Finder (1 idea, the first 900 px tall, 2 of its parts open)");
    expect(finderWhat({ cards: 0, top: null, height: null, open: 0, sort: "Overall" })).toBe("the whole Trade Finder");
    expect(finderWhat(null)).toBe("the whole Trade Finder");
    expect(cardWhat({ total: 6, opened: 2, planB: true }, true)).toBe("the first card on its own, everything on it opened (all 6 of its disclosures, 2 of them opened for the shot)");
    expect(cardWhat({ total: 4, opened: 0, planB: false }, true)).toBe(
      "the first card on its own, everything on it opened (all 4 of its disclosures, 0 of them opened for the shot; no Plan B box on it)",
    );
    expect(cardWhat(null, false)).toBe("the first card on its own, everything on it opened (its offers still being worked out)");
  });

  it("a skip says why a shot wasn't kept in fixed words, never an error's own message (it could quote the page)", () => {
    expect(shotSkipText("clutter-3-league", new ShotError(NAMES_LEFT))).toBe(`the screenshot "clutter-3-league" wasn't kept: ${NAMES_LEFT}`);
    const quoting = new TypeError("Gravel Gophers is not a function");
    expect(shotSkipText("clutter-3-league", quoting)).toBe('the screenshot "clutter-3-league" couldn\'t be saved (TypeError; --no-shots turns them off)');
    expect(shotSkipText("clutter-3-league", "x")).toContain("(error; --no-shots");
  });
});

describe("the in-page JavaScript compiles (TypeScript never checks it)", () => {
  const body = (code: string) => `return (async () => {\n${PAGE_HELPERS}\n${CARD_HELPERS}\n${code}\n})`;

  it("the bodies: the layout (whole page and an element), the text, the first card, opening, closing and scrolling", () => {
    for (const code of [shotLayoutCall(null), shotLayoutCall(FIRST_CARD, SHOT_MARGIN), shotLayoutCall(WAIVERS_SECTION, 12.5), SHOT_TEXT_CALL, FIRST_CARD_CALL, OPEN_OFFERS_CALL, OPEN_ALL_CALL, CARD_INTO_VIEW, CLOSE_OPENED_CALL, scrollToCall(0, 4_321.5)]) {
      expect(() => new Function(body(code)), code.slice(0, 60)).not.toThrow();
    }
  });

  it("the expressions the steps wait on", () => {
    for (const expression of [OFFERS_SETTLED, NO_COPIED]) expect(() => new Function(body(`return (${expression});`)), expression.slice(0, 60)).not.toThrow();
  });

  it("the layout reads the margin it's given, and a scroll back never takes a number that isn't one", () => {
    expect(shotLayoutCall(FIRST_CARD, SHOT_MARGIN)).toContain(`r.top + sy - ${SHOT_MARGIN}`);
    expect(shotLayoutCall(null)).toContain("if (false) {");
    expect(scrollToCall(Number.NaN, Number.POSITIVE_INFINITY)).toBe("window.scrollTo(0, 0); return true;");
  });

  it("the layout reads only what's painted: text and controls in a closed <details> aren't in the way (checkVisibility, else rendered())", () => {
    // Chrome lays out a closed <details>'s content when it's measured, as if it were open (in local headless Chrome, on a
    // synthetic page: 75 spans under a closed card without this rule, none with it).
    const code = shotLayoutCall(null);
    expect(code).toContain("el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })");
    expect(code).toContain("rendered(el, renderCache)");
    expect(code).toContain("|| !shown(p)) continue;");
    expect(code).toContain("if (shown(el)) add(el.getBoundingClientRect());");
  });
});

/** A fake page: answers each call by what it is, and records every call in order (`calls`) and every capture's clip (`clips`). */
function fakePage(over: { layout?: ShotLayout | null; text?: string; failCapture?: number; open?: { found: boolean; offers: boolean; x: number; y: number } } = {}) {
  const calls: string[] = [];
  const clips: Array<Record<string, unknown>> = [];
  let captures = 0;
  const layout: ShotLayout | null = over.layout === undefined ? { top: 0, bottom: 3_200, element: null, page: 3_200, spans: [[1_490.5, 1_511.5]] } : over.layout;
  const page = {
    calls,
    clips,
    async run<T>(code: string): Promise<T> {
      const kind =
        code === RESTORE_CALL
          ? "restore"
          : code.includes("window.__checkRestore = () =>")
            ? "sanitize"
            : (/\/\/ shot:([a-z-]+)/.exec(code)?.[1] ?? (code.includes("scrollIntoView") ? "into-view" : code.startsWith("window.scrollTo(") ? "scroll-back" : "other"));
      calls.push(kind);
      const answers: Record<string, unknown> = {
        restore: 3,
        sanitize: 3,
        layout,
        text: over.text ?? "Trade with Team 3. You give Drake Moorcroft.",
        "first-card": { cards: 2, top: 1_290, height: 1_200, open: 0, sort: "Overall" },
        "open-offers": over.open ?? { found: true, offers: true, x: 0, y: 4_321 },
        "open-all": { total: 5, opened: 2, planB: true },
      };
      return (kind in answers ? answers[kind] : true) as T;
    },
    async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push(method);
      if (method === "Page.captureScreenshot") {
        captures++;
        if (over.failCapture === captures) throw new Error("Page.captureScreenshot: no answer");
        clips.push(params);
        return { data: Buffer.from(`image ${captures}`).toString("base64") } as T;
      }
      return {} as T;
    },
    async waitFor<T>(): Promise<T> {
      calls.push("wait");
      return true as T;
    },
  };
  return page;
}

describe("a shot through a fake page (captureParts)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "check-browser-shots-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const clean = () => true;

  it("replaces the names, measures, captures each part at 375 px, one image px per CSS px, beyond the screen, checks the text, puts the names back", async () => {
    const page = fakePage();
    const shot = await captureParts(page as ShotPage, dir, "clutter-3-league", { sanitize: "/* names */ window.__checkRestore = () => 0;", target: null, clean });
    expect(page.calls).toEqual(["sanitize", "layout", "Page.captureScreenshot", "Page.captureScreenshot", "Page.captureScreenshot", "text", "restore"]);
    expect(page.clips).toEqual([
      { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: PHONE.width, height: 1_067, scale: 0.5 } },
      { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 1_067, width: PHONE.width, height: 1_067, scale: 0.5 } },
      { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 2_134, width: PHONE.width, height: 1_066, scale: 0.5 } },
    ]);
    expect(shot.files.map((f) => path.basename(f))).toEqual(["clutter-3-league-01.png", "clutter-3-league-02.png", "clutter-3-league-03.png"]);
    expect(readFileSync(shot.files[1] as string, "utf8")).toBe("image 2");
    expect(shot.parts).toHaveLength(3);
  });

  it("a shot in one part keeps its name", async () => {
    const page = fakePage({ layout: { top: 980, bottom: 2_204, element: 1_200, page: 9_000, spans: [] } });
    const shot = await captureParts(page as ShotPage, dir, "clutter-4-waivers", { sanitize: "window.__checkRestore = () => 0;", target: WAIVERS_SECTION, margin: SHOT_MARGIN, clean });
    expect(readdirSync(dir)).toEqual(["clutter-4-waivers.png"]);
    expect(page.clips[0]).toMatchObject({ clip: { y: 980, height: 1_224 } });
    expect(shot.layout.element).toBe(1_200);
  });

  it("a league name left on the page: nothing is kept, the names are put back, and it says why", async () => {
    const page = fakePage();
    await expect(captureParts(page as ShotPage, dir, "clutter-3-league", { sanitize: "window.__checkRestore = () => 0;", target: null, clean: () => false })).rejects.toThrow(NAMES_LEFT);
    expect(readdirSync(dir)).toEqual([]);
    expect(page.calls.at(-1)).toBe("restore");
  });

  it("a capture that fails: the images already written are deleted, the names put back, the error passed on", async () => {
    const page = fakePage({ failCapture: 2 });
    await expect(captureParts(page as ShotPage, dir, "clutter-3-league", { sanitize: "window.__checkRestore = () => 0;", target: null, clean })).rejects.toThrow("no answer");
    expect(readdirSync(dir)).toEqual([]);
    expect(page.calls.at(-1)).toBe("restore");
  });

  it("an element that isn't on the page: no capture, the names put back", async () => {
    const page = fakePage({ layout: null });
    await expect(captureParts(page as ShotPage, dir, "clutter-4-waivers", { sanitize: "window.__checkRestore = () => 0;", target: WAIVERS_SECTION, clean })).rejects.toThrow(TARGET_MISSING);
    expect(page.calls).toEqual(["sanitize", "layout", "restore"]);
    expect(existsSync(path.join(dir, "clutter-4-waivers.png"))).toBe(false);
  });
});

describe("the steps' shots (finderShot, openedCardShot, leagueShots)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "check-browser-shots-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const names: LeagueNames = { leagueName: "Fictional League", teams: [{ id: "3", name: "Gravel Gophers", ownerName: "Rowan Vale" }], players: ["Drake Moorcroft"] };
  const contextOf = (page: unknown, shotsDir: string | null) =>
    ({ page, report: new CheckReport(), shotsDir, names, leagueId: "12345", shots: [] as string[] }) as unknown as StepContext & { report: CheckReport; shots: string[] };

  it("--no-shots: none of them touches the page or the report", async () => {
    const untouchable = new Proxy({}, { get: () => () => Promise.reject(new Error("touched the page")) });
    const ctx = contextOf(untouchable, null);
    await finderShot(ctx, "Trade card");
    await openedCardShot(ctx, "Trade card");
    await leagueShots(ctx, "Waivers");
    expect(ctx.report.lines).toEqual([]);
    expect(ctx.report.numbers).toEqual({});
    expect(ctx.shots).toEqual([]);
  });

  it("shot 1: the whole page, its words from the first card, its images listed with the run's screenshots and its line noted", async () => {
    const page = fakePage();
    const ctx = contextOf(page, dir);
    await finderShot(ctx, "Trade card");
    expect(page.calls.slice(0, 3)).toEqual(["first-card", "sanitize", "layout"]);
    expect(ctx.shots.map((f) => path.basename(f))).toEqual(["clutter-1-trade-finder-01.png", "clutter-1-trade-finder-02.png", "clutter-1-trade-finder-03.png"]);
    expect(ctx.report.numbers["Trade card"]?.[CLUTTER_NOTE]).toEqual([
      "clutter-1-trade-finder: the whole Trade Finder (2 ideas sorted by Overall, the first starting 1,290 px down and 1,200 px tall, nothing on it opened); 3,200 px tall (3.9 phone screens) in 3 images",
    ]);
    expect(ctx.report.lines).toEqual([]);
  });

  it("shot 2: opens the card, waits for its offers, scrolls it into view, shoots it with its margin, then closes what it opened and puts the scroll back", async () => {
    const page = fakePage({ layout: { top: 4_309, bottom: 9_533, element: 5_200, page: 20_000, spans: [] } });
    const ctx = contextOf(page, dir);
    await openedCardShot(ctx, "Trade card");
    expect(page.calls).toEqual(["open-offers", "wait", "open-all", "wait", "into-view", "sanitize", "layout", ...Array(4).fill("Page.captureScreenshot"), "text", "restore", "close", "scroll-back"]);
    expect(ctx.report.numbers["Trade card"]?.[CLUTTER_NOTE]).toEqual([
      "clutter-2-trade-card-opened: the first card on its own, everything on it opened (all 5 of its disclosures, 2 of them opened for the shot); 5,200 px tall (6.4 phone screens) in 4 images",
    ]);
  });

  it("shot 2 with no card on the page: a skip, and what it might have opened closed anyway", async () => {
    const page = fakePage({ open: { found: false, offers: false, x: 0, y: 0 } });
    const ctx = contextOf(page, dir);
    await openedCardShot(ctx, "Trade card");
    expect(ctx.report.lines).toEqual([{ step: "Trade card", status: "skip", text: `the screenshot "${CLUTTER_SHOTS.card}" wasn't kept: ${TARGET_MISSING}`, details: [] }]);
    expect(page.calls).toEqual(["open-offers", "close", "scroll-back"]);
  });

  it("shots 3 and 4: the whole League page, then Waiver upgrades on its own, both lines noted in order", async () => {
    const page = fakePage();
    const ctx = contextOf(page, dir);
    await leagueShots(ctx, "Waivers");
    const notes = ctx.report.numbers.Waivers?.[CLUTTER_NOTE] as string[];
    expect(notes.map((n) => n.split(":")[0])).toEqual(["clutter-3-league", "clutter-4-waivers"]);
    expect(ctx.shots).toHaveLength(6);
  });

  it("a league name left on the page (the run's own leftover check): a skip, no image kept, nothing noted", async () => {
    const page = fakePage({ text: "Trade with Gravel Gophers (Rowan Vale)" });
    const ctx = contextOf(page, dir);
    await leagueShots(ctx, "Waivers");
    expect(ctx.report.lines.map((l) => l.text)).toEqual([`the screenshot "clutter-3-league" wasn't kept: ${NAMES_LEFT}`, `the screenshot "clutter-4-waivers" wasn't kept: ${NAMES_LEFT}`]);
    expect(readdirSync(dir)).toEqual([]);
    expect(ctx.shots).toEqual([]);
    expect(ctx.report.numbers).toEqual({});
  });
});
