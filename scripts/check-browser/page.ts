/**
 * The page under test for `npm run check:browser`: one tab of the browser, emulating a phone (375 × 812 CSS px,
 * device pixel ratio 2, touch), reached over a flattened CDP session (cdp.ts), with its Web Workers attached too so
 * their console errors and exceptions count.
 *
 * What it records, each tagged with the step that was running (PageEvent):
 * - console errors and failed assertions (page and workers), uncaught exceptions, and browser log errors other than
 *   the network's (those are the requests below);
 * - Content-Security-Policy violations (Part B: production builds send a full policy), enforced or report-only: in the
 *   page, the browser's own log line (any level) and the instrumentation's securitypolicyviolation listener (inPage.ts
 *   CSP_MARK), which also catches what Chrome blocks without a log line (an eval); in a worker, the CSP issue Chrome
 *   files for it (CDP Audits.issueAdded, measured with Chrome 154: a worker's violation shows nowhere else);
 * - requests to the app that failed (HTTP 400 and up, or a network error other than a cancel or an abort: Next
 *   cancels prefetches and the app aborts what a page no longer needs);
 * - any request to another host (the app's pages only talk to their own server; the FantasyCalc and platform links
 *   are links, not requests), except the browser's own reads of a league from ESPN and Sleeper (Part B, track BF: the
 *   CSP's connect-src, next.config.ts BROWSER_FETCH_ORIGINS), which are recorded as "platform read" (not a problem: the
 *   steps count them, which is how the Connect step tells which path read the league), and as "platform failure" when
 *   one fails (a CORS refusal, a network error: a problem). Only the league-data requests count as reads
 *   (src/adapters/upload.ts isLeagueDataRead, review BF-R6): any other request to those hosts (projections, stats, the
 *   players list, the NFL schedule, which the server reads) is "other host", a problem. Their texts carry the host and
 *   what was read, never an id (platformReadText);
 * - console warnings, counted for the summary but not failures.
 * The in-page instrumentation (inPage.ts INSTRUMENT) is added to every new document.
 *
 * Texts are kept whole (never cut: a name cut in two can't be cleaned; the entry point cleans, then cuts); a text over
 * TEXT_KEEP_MAX characters isn't kept at all.
 *
 * Interaction: evaluations in the page (`run` wraps a body with the in-page helpers), polling waits that survive
 * navigations, trusted mouse clicks at an element's center (Input.dispatchMouseEvent, after scrolling it into view),
 * and screenshots: the first screen and the whole page (capped), always after the page's names were replaced with
 * placeholders (inPage.ts sanitizeCall), which are put back right after (RESTORE_CALL), so later checks read the real
 * page.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isLeagueDataRead } from "@/adapters/upload";
import { BROWSER_FETCH_ORIGINS } from "../../next.config";
import type { CdpClient, CdpEvent } from "./cdp";
import { CARD_HELPERS, CSP_MARK, INSTRUMENT, PAGE_HELPERS, RESTORE_CALL } from "./inPage";

export const PHONE = { width: 375, height: 812, deviceScaleFactor: 2 } as const;

export type PageEventKind = "console error" | "exception" | "failed request" | "other host" | "csp violation" | "console warning" | "platform read" | "platform failure";

/** Whether a request goes to ESPN's or Sleeper's API, the hosts the CSP lets the page read (next.config.ts BROWSER_FETCH_ORIGINS). */
export function isPlatformHost(url: string): boolean {
  return BROWSER_FETCH_ORIGINS.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

/**
 * Whether a request is the browser's own read of a league (the header): one of the league-data requests the browser path
 * makes (src/adapters/upload.ts isLeagueDataRead). Anything else to those hosts (projections, stats, the players list, the
 * NFL schedule: the server's to read) counts as another host, a problem (review BF-R6).
 */
export function isPlatformRead(url: string): boolean {
  return isPlatformHost(url) && isLeagueDataRead(url);
}

/**
 * The path words of the platform reads the app makes (src/adapters/sleeper/leagueData.ts sleeperUrls), and of Sleeper's
 * public data the server reads (so a request the browser shouldn't make says what it was); anything else is an id.
 */
const PATH_WORDS = new Set(["v1", "league", "leagues", "user", "nfl", "state", "users", "rosters", "matchups", "transactions", "traded_picks", "drafts", "projections", "stats", "players"]);

/**
 * A platform read in words without any id (pure): the method, the host and what was read: ESPN's views ("view=mSettings,
 * mTeam, …"), Sleeper's path with every number as "#" and anything else that isn't one of its words (a username) as "…"
 * ("/v1/league/#/matchups/#", "/v1/user/…").
 */
export function platformReadText(url: string, method: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `${method} (an address that can't be read)`;
  }
  const views = u.searchParams.getAll("view");
  if (views.length) return `${method} ${u.host} view=${views.join(",")}`;
  const parts = u.pathname.split("/").map((p) => (p === "" || PATH_WORDS.has(p) ? p : /^\d+$/.test(p) ? "#" : "…"));
  return `${method} ${u.host}${parts.join("/")}`;
}

export interface PageEvent {
  step: string;
  kind: PageEventKind;
  where: "page" | "worker";
  text: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An evaluation that threw in the page. */
export class PageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageError";
  }
}

/** A text longer than this isn't kept at all (only that it happened): it's never cut (the file header). */
export const TEXT_KEEP_MAX = 100_000;

function str(x: unknown): string {
  return typeof x === "string" ? x : x === undefined || x === null ? "" : String(x);
}

/** A console call's arguments in words (values, else descriptions), whole. */
function consoleText(args: unknown): string {
  if (!Array.isArray(args)) return "";
  return args
    .map((a) => {
      const arg = a as { value?: unknown; description?: unknown; type?: unknown };
      return arg.value !== undefined ? (typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)) : str(arg.description ?? arg.type);
    })
    .join(" ");
}

/** What an event keeps of a text (pure): all of it, or, past TEXT_KEEP_MAX, only its length. */
export function keptText(text: string): string {
  return text.length > TEXT_KEEP_MAX ? `(a ${text.length}-character text, not kept)` : text;
}

/** A browser log line about a Content-Security-Policy (Chrome: "Refused to … because it violates the following Content Security Policy directive", "[Report Only] …"). */
const CSP_TEXT = /Content[- ]Security[- ]Policy/i;

/**
 * What a browser log entry (CDP Log.entryAdded) counts as (pure): a CSP violation at any level (a report-only one
 * included), an error other than the network's (requests are watched apart), or nothing.
 */
export function logEntryKind(entry: { level?: unknown; source?: unknown; text?: unknown }): PageEventKind | null {
  const text = str(entry.text);
  if (CSP_TEXT.test(text)) return "csp violation";
  if (entry.level === "error" && entry.source !== "network") return "console error";
  return null;
}

/**
 * A CSP issue Chrome filed (CDP Audits.issueAdded) in words (pure), or null for any other issue: the directive, what kind
 * of violation, report-only or not, and where.
 */
export function cspIssueText(issue: unknown): string | null {
  const i = (issue ?? {}) as { code?: unknown; details?: { contentSecurityPolicyIssueDetails?: Record<string, unknown> } };
  if (i.code !== "ContentSecurityPolicyIssue") return null;
  const d = i.details?.contentSecurityPolicyIssueDetails ?? {};
  const at = (d.sourceCodeLocation ?? {}) as { url?: unknown; lineNumber?: unknown };
  const blocked = str(d.blockedURL);
  return `CSP issue: ${str(d.violatedDirective) || "?"} (${str(d.contentSecurityPolicyViolationType) || "?"}${d.isReportOnly === true ? ", report-only" : ""})${blocked ? ` blocked ${blocked}` : ""}${at.url ? ` at ${str(at.url)}:${str(at.lineNumber)}` : ""}`;
}

/** What a console call (CDP Runtime.consoleAPICalled) counts as (pure): the instrumentation's CSP report, an error, a warning, or nothing. */
export function consoleCallKind(type: string, text: string): PageEventKind | null {
  if (text.startsWith(CSP_MARK)) return "csp violation";
  if (type === "error" || type === "assert") return "console error";
  if (type === "warning") return "console warning";
  return null;
}

/** Requests that aren't the app's and aren't worth flagging: inline data, blobs and the browser's own pages. */
const LOCAL_SCHEMES = /^(data:|blob:|about:|chrome:|chrome-extension:|devtools:)/;

export class PageSession {
  /** The step now running; events are tagged with it. */
  step = "setup";
  readonly events: PageEvent[] = [];
  private readonly workers = new Set<string>();
  private readonly requests = new Map<string, { url: string; method: string }>();

  private constructor(
    private readonly cdp: CdpClient,
    readonly sessionId: string,
    readonly origin: string,
  ) {
    cdp.on((e) => this.onEvent(e));
  }

  /** Opens a new tab, attaches to it and sets up the phone, the instrumentation and the workers' sessions. */
  static async open(cdp: CdpClient, origin: string): Promise<PageSession> {
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = new PageSession(cdp, sessionId, origin);
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await page.send(`${domain}.enable`);
    await page.setWidth();
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
    await page.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    // The pitch's Copy button writes to the clipboard; the check reads it back.
    await cdp.send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => undefined);
    return page;
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId, timeoutMs);
  }

  /** Emulates the phone at `width` CSS px (its height, pixel ratio and touch unchanged); none: the phone's own 375 px. */
  async setWidth(width: number = PHONE.width): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height: PHONE.height, deviceScaleFactor: PHONE.deviceScaleFactor, mobile: true });
  }

  private record(kind: PageEventKind, where: "page" | "worker", text: string): void {
    if (this.events.length < 2_000) this.events.push({ step: this.step, kind, where, text: keptText(text) });
  }

  private onEvent(e: CdpEvent): void {
    const fromPage = e.sessionId === this.sessionId;
    const fromWorker = e.sessionId !== undefined && this.workers.has(e.sessionId);
    if (!fromPage && !fromWorker) return;
    const where = fromWorker ? "worker" : "page";
    const p = e.params;
    switch (e.method) {
      case "Target.attachedToTarget": {
        const child = str(p.sessionId);
        const type = str((p.targetInfo as { type?: unknown } | undefined)?.type);
        if (child && (type === "worker" || type === "shared_worker" || type === "service_worker")) {
          this.workers.add(child);
          void this.cdp.send("Runtime.enable", {}, child).catch(() => undefined);
          // The worker's own log lines, and its issues: Chrome files a worker's CSP violation only as an issue (Audits).
          void this.cdp.send("Log.enable", {}, child).catch(() => undefined);
          void this.cdp.send("Audits.enable", {}, child).catch(() => undefined);
          void this.cdp.send("Runtime.runIfWaitingForDebugger", {}, child).catch(() => undefined);
        }
        break;
      }
      case "Target.detachedFromTarget":
        this.workers.delete(str(p.sessionId));
        break;
      case "Runtime.consoleAPICalled": {
        const text = consoleText(p.args);
        const kind = consoleCallKind(str(p.type), text);
        if (kind) this.record(kind, where, text);
        break;
      }
      case "Runtime.exceptionThrown": {
        const d = (p.exceptionDetails ?? {}) as { text?: unknown; exception?: { description?: unknown } };
        this.record("exception", where, str(d.exception?.description) || str(d.text));
        break;
      }
      case "Audits.issueAdded": {
        // Workers only: the page's violations are already its log lines and the instrumentation's reports.
        const text = where === "worker" ? cspIssueText(p.issue) : null;
        if (text) this.record("csp violation", where, text);
        break;
      }
      case "Log.entryAdded": {
        const entry = (p.entry ?? {}) as { level?: unknown; source?: unknown; text?: unknown };
        // Network errors arrive as requests below; a CSP violation counts at any level; any other error counts here.
        const kind = logEntryKind(entry);
        if (kind) this.record(kind, where, `${str(entry.source)}: ${str(entry.text)}`);
        break;
      }
      case "Network.requestWillBeSent": {
        const req = (p.request ?? {}) as { url?: unknown; method?: unknown };
        const url = str(req.url);
        const method = str(req.method) || "GET";
        this.requests.set(str(p.requestId), { url, method });
        // The browser's own read of a league (the header): expected, counted, and kept without its ids.
        if (url && isPlatformRead(url)) this.record("platform read", where, platformReadText(url, method));
        // Anything else to those hosts is data the server reads (review BF-R6): a problem, kept without ids too.
        else if (url && isPlatformHost(url)) this.record("other host", where, `${platformReadText(url, method)} (not a league read: the server's to read)`);
        else if (url && !LOCAL_SCHEMES.test(url) && !url.startsWith(this.origin)) this.record("other host", where, `${method} ${url}`);
        break;
      }
      case "Network.responseReceived": {
        const res = (p.response ?? {}) as { status?: unknown; url?: unknown };
        const status = typeof res.status === "number" ? res.status : 0;
        const url = str(res.url);
        if (status >= 400 && url.startsWith(this.origin)) this.record("failed request", where, `HTTP ${status} ${this.shortUrl(url)}`);
        break;
      }
      case "Network.loadingFailed": {
        const id = str(p.requestId);
        const req = this.requests.get(id);
        this.requests.delete(id);
        const error = str(p.errorText);
        if (p.canceled === true || error === "net::ERR_ABORTED" || !req) break;
        // A platform read that failed (a CORS refusal, a network error): the browser path didn't work (the header).
        if (isPlatformHost(req.url)) this.record("platform failure", where, `${error} ${platformReadText(req.url, req.method)}`);
        else if (req.url.startsWith(this.origin)) this.record("failed request", where, `${error} ${req.method} ${this.shortUrl(req.url)}`);
        break;
      }
      case "Network.loadingFinished":
        this.requests.delete(str(p.requestId));
        break;
    }
  }

  /** The app's URL without its origin (whole: the entry point cuts it after cleaning). */
  private shortUrl(url: string): string {
    return url.startsWith(this.origin) ? url.slice(this.origin.length) : url;
  }

  /** Events of one step (all kinds). */
  eventsOf(step: string): PageEvent[] {
    return this.events.filter((e) => e.step === step);
  }

  /** Evaluates an expression in the page (awaiting promises) and returns its JSON value; throws PageError when it threw. */
  async evaluate<T>(expression: string, opts: { gesture?: boolean; timeoutMs?: number } = {}): Promise<T> {
    const res = await this.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: opts.gesture ?? false },
      opts.timeoutMs,
    );
    if (res.exceptionDetails) throw new PageError(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "the page threw");
    return res.result?.value as T;
  }

  /** Runs `body` (statements ending in a return) as an async function with the in-page helpers in scope. */
  run<T>(body: string, opts: { cards?: boolean; timeoutMs?: number } = {}): Promise<T> {
    return this.evaluate<T>(`(async () => {\n${PAGE_HELPERS}\n${opts.cards ? CARD_HELPERS : ""}\n${body}\n})()`, opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {});
  }

  /**
   * Polls `expression` (with the in-page helpers) until it's truthy and returns its value; throws after `timeoutMs`.
   * A navigation in between (the context gone for a moment) just means another try. An element found counts as true
   * (a DOM node can't come back by value).
   */
  async waitFor<T>(expression: string, timeoutMs: number, label: string, everyMs = 100): Promise<T> {
    const started = Date.now();
    for (;;) {
      let value: unknown;
      try {
        value = await this.run<unknown>(`const __value = (${expression}); return __value && typeof __value === "object" && typeof __value.nodeType === "number" ? true : __value;`, { cards: true });
      } catch {
        value = undefined;
      }
      if (value) return value as T;
      if (Date.now() - started > timeoutMs) throw new PageError(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${label}`);
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  /** A trusted click at the center of the element `findExpr` returns (scrolled into view first); throws when it's missing. */
  async click(findExpr: string, label: string): Promise<Box> {
    const box = await this.run<Box | null>(
      `const el = (${findExpr}); if (!el) return null; el.scrollIntoView({ block: "center" }); await sleep(150); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };`,
      { cards: true },
    );
    if (!box) throw new PageError(`couldn't find ${label} to tap`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    }
    return box;
  }

  /** A full page load of an address on the app; resolves once it has loaded. */
  async navigate(pathname: string, timeoutMs = 60_000): Promise<void> {
    await this.send("Page.navigate", { url: `${this.origin}${pathname}` });
    const target = pathname.split("?")[0] ?? pathname;
    await this.waitFor(`document.readyState === "complete" && location.pathname === ${JSON.stringify(target)}`, timeoutMs, `${target} to load`);
  }

  /**
   * Saves the first screen and the whole page (up to `maxHeight` CSS px) as PNGs in `dir`, after replacing the page's
   * names with placeholders (`sanitize`: the caller's inPage.ts sanitizeCall), and puts the page's own text back
   * afterwards, whatever happened (RESTORE_CALL). Returns the files written.
   */
  async screenshots(dir: string, name: string, sanitize: string, maxHeight = 8_000): Promise<string[]> {
    const files: string[] = [];
    try {
      await this.run(sanitize);
      mkdirSync(dir, { recursive: true });
      const first = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      const firstFile = path.join(dir, `${name}.png`);
      writeFileSync(firstFile, Buffer.from(first.data, "base64"));
      files.push(firstFile);
      const height = await this.run<number>(`return Math.min(${maxHeight}, document.documentElement.scrollHeight);`);
      if (height > PHONE.height) {
        // Half scale: the device pixel ratio is 2, so the whole page comes out 375 px wide.
        const full = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: PHONE.width, height, scale: 0.5 } }, 120_000);
        const fullFile = path.join(dir, `${name}-full.png`);
        writeFileSync(fullFile, Buffer.from(full.data, "base64"));
        files.push(fullFile);
      }
      return files;
    } finally {
      await this.run(RESTORE_CALL).catch(() => undefined);
    }
  }
}
