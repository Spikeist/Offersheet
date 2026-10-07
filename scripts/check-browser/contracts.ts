/**
 * The rules behind Checkpoint 7b's checks of `npm run check:browser` (pure; tested in check-browser.test.ts): what the
 * pages must never show, and what they must. The steps (steps.ts) read the pages (inPage.ts); these decide.
 *
 * Planner reply to Checkpoint 7a (reports/planner-reply-7a.md):
 * - 5.4, FantasyCalc's conditions (reports/fantasycalc-permission.md): Offer Sheet never displays FantasyCalc's values.
 *   No value number or value comparison on a trade card, its reasons, its message and the Analyzer's "Details" included
 *   (valueLeaks: the old wordings, and a bare number of 1,000 or more that isn't a year, a percentage, or a count of points
 *   or seasons); none anywhere on the League page, its player breakdowns' old market numbers included (pageValueLeaks,
 *   breakdownLeaks); the market blend said in words (BLEND_WORDS). Every page links back to fantasycalc.com from its
 *   footer in the server's own HTML, and every link to FantasyCalc has rel exactly "noopener" and referrerpolicy "origin"
 *   (fantasyCalcLinksInHtml, fantasyCalcLinkIssues, over APP_PAGES); a card's numbers credit FantasyCalc with one sentence
 *   and the link (creditProblems). Since Checkpoint 7c npm run prod:deploy reads the same rules on the production domain
 *   after a deploy, with foreignResourcesInHtml (planner reply to Checkpoint 7b, §2: no third-party scripts); this file
 *   imports nothing, so the deploy script loads none of the app.
 * - 5.1, plain-language notices: no warning code, JSON path or field name, stat ID or player-ID matching talk where users
 *   read (noticeLeaks, internalPaths), Parker's league reading as the planner expects (PARKER_QUIET_LINE, noticeCount).
 * - 5.3: the Trade Finder's freshness line (freshnessLineOk).
 * - 6.1: the Settings page's read-only playoff weight (playoffWeightRead).
 * - 6.2: the waiver view's toggle (waiverToggleKind), and the header's six links in two rows at 375 px (rowCount).
 * - The Trade Analyzer's "Back to the Trade Finder" isn't prefetched (requestNamesAddress: which requests name its
 *   address, team id included).
 *
 * Every text these rules read was cleaned of the league's names in the page first (report.ts's rules), so a team named
 * "BIG_DAWGS" or "Squad 4000" is never taken for a code or a value.
 */

// ---------------------------------------------------------------------------------------------
// Notices (§5.1)

/** A warning code's shape ("ESPN_SCORING_UNMAPPED"). */
const CODE_TOKEN = /\b[A-Z]{2,}_[A-Z0-9_]+\b/g;
/** Lineup slot names a platform writes this way (Sleeper's SUPER_FLEX, REC_FLEX…): names users know, not codes. */
const SLOT_NAME = /^[A-Z]+_FLEX$/;

/** The warning codes in a text, each once (pure). */
export function codeTokens(text: string): string[] {
  return [...new Set([...text.matchAll(CODE_TOKEN)].map((m) => m[0]).filter((t) => !SLOT_NAME.test(t)))];
}

/**
 * Internals the planner named (§5.1: JSON paths, stat IDs, the player-ID matching row the Import Report had), and the
 * adapters' own ID-matching words (ESPN_PLAYER_MATCHED_BY_NAME's "isn't in any player ID source", ESPN_ID_CONFLICT's "The
 * player ID sources disagree", ESPN_ID_COLLISION's "matched a Sleeper id"): the notices say these in plain words ("We could
 * only identify …", "Our data sources disagree …"), so these words show only in the technical details.
 */
export const INTERNAL_TERMS = ["statId", "scoringItems", "player.id", "Matched to the player database", "player ID source", "Sleeper id"] as const;

/**
 * The rest of §5.1's "JSON paths" and "stat IDs" (review of the 7b checks: the platforms' paths the adapters attach to
 * warnings, src/adapters/*: "settings.scheduleSettings.playoffSeedingRule", "teams[].owners", "schedule[].winner", and
 * field names in their messages, "defaultPositionId", "keeperCountFuture"): a path with an array step ("teams[]",
 * "scoringItems[12]"); a dotted path with a camelCase step ("status.isWaiverOrderEdited"); a field name with two humps or
 * more, starting lower case (one hump is left alone: "iPhone"); "stat id" in any case and spacing. Plain words never match
 * (a domain, "e.g.", "A.J. Brown", "D/ST", a decimal), nor a lowercase dotted path ("settings.type"), which can't be told
 * from a domain.
 */
const JSON_PATH = /\b[a-z][A-Za-z0-9]*\[\d*\](?:\.[A-Za-z][A-Za-z0-9]*(?:\[\d*\])?)*|\b[a-z][a-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*\.[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+){2,}\b/g;
const STAT_ID = /\bstat ?ids?\b/gi;

/** The JSON paths, field names and stat-ID wording in a text, each once (pure). */
export function internalPaths(text: string): string[] {
  return [...new Set([...text.matchAll(JSON_PATH), ...text.matchAll(STAT_ID)].map((m) => m[0]))];
}

/** What a text shows that only the technical details may (pure): its codes, internal terms and paths, in words. */
export function noticeLeaks(text: string): string[] {
  const terms = INTERNAL_TERMS.filter((t) => text.includes(t));
  // A path the named terms already cover ("settings.scoringSettings.scoringItems[12]", "statId") is said once, by its term.
  const paths = internalPaths(text).filter((p) => !terms.some((t) => p.includes(t) || t.includes(p)));
  return [...codeTokens(text).map((t) => `the code ${t}`), ...terms.map((t) => `"${t}"`), ...paths.map((p) => `the path or field name "${p}"`)];
}

/** The Import Report's "Notices" tile in a number (pure): "None" 0, "1 notice" 1, "3 notices" 3; null for anything else. */
export function noticeCount(tile: string | null): number | null {
  if (tile === null) return null;
  const t = tile.replace(/\s+/g, " ").trim();
  if (t === "None") return 0;
  const m = /^(\d+) notices?$/.exec(t);
  return m ? Number(m[1]) : null;
}

/** The quiet line Parker's league shows in the Import Report's scoring section (the planner's words, §5.1). */
export const PARKER_QUIET_LINE = "Two rare rules aren't counted: 1-point safeties and blocked-kick return touchdowns. They almost never happen.";

// ---------------------------------------------------------------------------------------------
// FantasyCalc's values (§5.4)

/**
 * How the cards said trade value until Phase 7b: none may show again. Besides the planner's four (5.4), the wordings the
 * app's own guard forbids too (src/lib/fantasyCalcHidden.test.ts FORBIDDEN): "8% more value", a decimal share, Phase 4c's
 * long-term reasons ("Raises your roster's long-term value by 6%", "Costs 3% of your roster's long-term value") and the
 * old Details' "from your odds alone: 41"; and the card's old facts with a number ("Long-term value: +350 for your roster").
 * A card's facts are a term and its value (<dt>, <dd>), read as "Trade value You give 6,500, …": the colon is optional. A
 * share right after "<" or ">" is a printed odds figure read out in words ("<1%" said "less than 1%": "<1% less than 1%").
 */
const VALUE_PHRASES: readonly RegExp[] = [
  /Trade value:?\s+You give/gi,
  /By FantasyCalc['’]s (?:trade )?values/gi,
  /(?<![<>\d.])\d+(?:\.\d+)?% (?:more|less) (?:trade value|value|than)/gi,
  /times as much/gi,
  /long-term value by \d+(?:\.\d+)?%/gi,
  /\d+(?:\.\d+)?% of your roster/gi,
  /from your odds alone: \d/gi,
  /Long-term value:?\s+[+−-]?\d/gi,
];

/**
 * A whole number of 1,000 or more, with or without its thousands commas, not part of a longer number or a decimal (a comma
 * or a period after it in a sentence is punctuation: "You give 6,500, you get 5,400.").
 */
const BIG_NUMBER = /(?<![\d.])(?<!\d,)(?:\d{1,3}(?:,\d{3})+|\d{4,})(?!\d)(?![.,]\d)/g;
/** What may follow such a number: a percentage, or a count of projected points or simulated seasons (ours, not FantasyCalc's). */
const ALLOWED_AFTER = /^\s*(?:%|(?:ROS\s+)?(?:pts?|points?)\b|projected points\b|times\b|seasons?\b|simulations?\b)/i;
/** A plain four-digit year. */
const YEAR = /^(?:19|20)\d\d$/;
/** The card's ROS sentence ("You get 1,142 ROS pts, give 1,018"): our projections, its second number without a unit. */
const ROS_SENTENCE = /You get [\d,]+ ROS pts?, give [\d,]+/g;

/** A match with a little of the text around it, for the report. */
function snippet(text: string, start: number, end: number, around = 30): string {
  const from = Math.max(0, start - around);
  const to = Math.min(text.length, end + around);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/**
 * The numbers in a card's text that could be FantasyCalc's values (pure): every whole number of 1,000 or more but a year,
 * a percentage, points or seasons, and the ROS sentence's; each with its context.
 */
export function bareValueNumbers(text: string): string[] {
  const t = text.replace(ROS_SENTENCE, (m) => m.replace(/\d[\d,]*/g, "#"));
  const out: string[] = [];
  for (const m of t.matchAll(BIG_NUMBER)) {
    const n = m[0];
    const end = m.index + n.length;
    if (YEAR.test(n) || ALLOWED_AFTER.test(t.slice(end, end + 30))) continue;
    out.push(`the number ${n} ("${snippet(t, m.index, end)}")`);
  }
  return out;
}

/** The old value wordings in a text (pure), each with its context. */
function valuePhrases(text: string): string[] {
  const out: string[] = [];
  for (const re of VALUE_PHRASES) for (const m of text.matchAll(re)) out.push(`"${m[0]}" ("${snippet(text, m.index, m.index + m[0].length)}")`);
  return out;
}

/** What a trade card's text shows of FantasyCalc's values (pure): the old value wordings, and bareValueNumbers. */
export function valueLeaks(text: string): string[] {
  return [...valuePhrases(text), ...bareValueNumbers(text)];
}

/**
 * How the League page's breakdowns showed the market's numbers until Phase 7b ("Our projection 210 · Trade market 170 · Used
 * 190"; "Trade market: no comparison (top value at his position)"; a capped blend's "would be 130").
 */
const BREAKDOWN_LEAK = /Our projection \d|Trade market:? \d|would be \d|no comparison \(|(?:top|lowest) value at his position/g;

/** The market's numbers in a player's breakdown or hover text (pure), each with its context. */
export function breakdownLeaks(text: string): string[] {
  return [...text.matchAll(BREAKDOWN_LEAK)].map((m) => `"${m[0]}" ("${snippet(text, m.index, m.index + m[0].length)}")`);
}

/** The old estimate marker before a value ("~1,234": our estimate of a player FantasyCalc doesn't value, until Phase 7b). */
const ESTIMATE_MARK = /~\s*\d[\d,]*/g;

/**
 * FantasyCalc's values in words anywhere on the League page (pure; 5.4: "Remove every FantasyCalc value number and value
 * comparison from … the League page"): the cards' old value wordings, the breakdowns' market numbers and the estimates'
 * "~" marker, wherever they'd show (a trade chip, a partner card, the waiver view, the explainer; the page writes "~"
 * nowhere else). Not bare numbers: the page's own ROS totals and season counts are big numbers too.
 */
export function pageValueLeaks(text: string): string[] {
  const estimates = [...text.matchAll(ESTIMATE_MARK)].map((m) => `"${m[0]}" ("${snippet(text, m.index, m.index + m[0].length)}")`);
  return [...valuePhrases(text), ...breakdownLeaks(text), ...estimates];
}

/** How a blended player's breakdown says it, in words (leagueView.ts blendText). */
export const BLEND_WORDS = /toward the trade market['’]s view|barely moves/;
/** A breakdown or hover text that talks about the market blend at all. */
export const MENTIONS_MARKET = /trade market/i;

/** An address on FantasyCalc's site (www. too, so a link that strays from fantasycalc.com is still checked). */
export function isFantasyCalcHref(href: string | null | undefined): boolean {
  return typeof href === "string" && /^https?:\/\/(?:www\.)?fantasycalc\.com(?:[/?#]|$)/i.test(href.trim());
}

/** A link to FantasyCalc as a page has it. */
export interface FantasyCalcLink {
  href: string;
  /** Its rel attribute as written (null: none). */
  rel: string | null;
  /** Its referrerpolicy attribute (React writes referrerPolicy; HTML names aren't case-sensitive), null: none. */
  referrerPolicy: string | null;
  /** Inside a <footer>. */
  inFooter: boolean;
  /** What keeps it from showing without JavaScript, if anything ("details", "div[hidden]", "noscript"…); null: nothing. */
  hiddenBy: string | null;
}

/** Elements without an end tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** An attribute value or a text as the HTML means it (the entities React writes). */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
    return named[(name ?? "").toLowerCase()] ?? whole;
  });
}

/** A start tag's attributes, by lower-case name (pure). */
export function attributesOf(source: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const m of source.matchAll(ATTR)) {
    const name = (m[1] as string).toLowerCase();
    if (out.has(name)) continue;
    const value = m[2] ?? m[3] ?? m[4];
    out.set(name, value === undefined ? null : decodeEntities(value));
  }
  return out;
}

/** Why an element hides what's inside it from a reader without JavaScript, or null. */
function hides(name: string, attrs: Map<string, string | null>): string | null {
  if (attrs.has("hidden")) return `${name}[hidden]`;
  if ((name === "details" || name === "dialog") && !attrs.has("open")) return name;
  if (name === "template" || name === "noscript") return name;
  if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.get("style") ?? "")) return `${name}[style]`;
  return null;
}

/**
 * Every link to FantasyCalc in a page's server HTML, before any JavaScript runs (pure): its rel and referrerpolicy, whether
 * a <footer> holds it, and what hides it if anything (a closed <details>, [hidden], <noscript>…; the streamed parts Next
 * sends in hidden <div>s until a script places them). Comments, scripts and styles are left out first: Next's inline data
 * repeats the markup as data, which isn't a link. React writes every end tag, so the open elements are a plain stack.
 */
export function fantasyCalcLinksInHtml(html: string): FantasyCalcLink[] {
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const open: Array<{ name: string; hides: string | null }> = [];
  const links: FantasyCalcLink[] = [];
  for (const m of markup.matchAll(TAG)) {
    const name = (m[2] as string).toLowerCase();
    if (m[1]) {
      const at = open.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) open.length = at;
      continue;
    }
    const attrs = attributesOf(m[3] ?? "");
    const self = { name, hides: hides(name, attrs) };
    if (name === "a" && isFantasyCalcHref(attrs.get("href"))) {
      links.push({
        href: (attrs.get("href") ?? "").trim(),
        rel: attrs.get("rel") ?? null,
        referrerPolicy: attrs.get("referrerpolicy") ?? null,
        inFooter: open.some((e) => e.name === "footer"),
        hiddenBy: [...open, self].find((e) => e.hides)?.hides ?? null,
      });
    }
    if (!VOID.has(name) && !m[4]) open.push(self);
  }
  return links;
}

/**
 * What's wrong with a page's FantasyCalc links (pure; FantasyCalc's condition 2): each has rel exactly "noopener" (no
 * noreferrer, no nofollow) and referrerpolicy "origin"; with `requireFooter`, at least one (https://fantasycalc.com) sits
 * in the footer with nothing hiding it.
 */
export function fantasyCalcLinkIssues(links: readonly FantasyCalcLink[], opts: { requireFooter: boolean }): string[] {
  const out: string[] = [];
  links.forEach((l, i) => {
    const which = `FantasyCalc link ${i + 1}${l.inFooter ? " (footer)" : ""}`;
    if ((l.rel ?? "").trim() !== "noopener") out.push(`${which}: rel ${l.rel === null ? "is missing" : `is "${l.rel}"`}, not exactly "noopener"`);
    if ((l.referrerPolicy ?? "").trim().toLowerCase() !== "origin") out.push(`${which}: referrerpolicy ${l.referrerPolicy === null ? "is missing" : `is "${l.referrerPolicy}"`}, not "origin"`);
  });
  if (opts.requireFooter) {
    const footer = links.filter((l) => l.inFooter && /^https:\/\/fantasycalc\.com/i.test(l.href));
    if (!footer.length) out.push("no link to https://fantasycalc.com in the footer");
    else if (footer.every((l) => l.hiddenBy)) out.push(`the footer's FantasyCalc link is hidden without JavaScript (inside ${footer[0]?.hiddenBy})`);
  }
  return out;
}

/**
 * Every app page, whose server HTML must link back to FantasyCalc from its footer (planner reply to Checkpoint 7a, 5.4):
 * read by check:browser's FantasyCalc step and, on the production domain after a deploy, by npm run prod:deploy (planner
 * reply to Checkpoint 7b, §2: "every page answers 200, with the FantasyCalc link in its HTML and no third-party scripts").
 * Here since Checkpoint 7c (steps.ts re-exports it): steps.ts loads the app's code, which prod:deploy has no use for.
 */
export const APP_PAGES = ["/", "/connect", "/import", "/league", "/trades", "/analyzer", "/settings", "/privacy", "/terms", "/feedback"] as const;

/** Link types that make the browser fetch what they point at (a resource of the page, not a link a reader follows). */
const FETCHING_LINKS = new Set(["preload", "modulepreload", "prefetch", "stylesheet"]);

/**
 * What a page's server HTML loads from another site (pure; planner reply to Checkpoint 7b, §2: "no third-party scripts"):
 * a script, a frame, an embedded object, a preloaded or prefetched file, a stylesheet, or a <base> that would send the
 * page's own addresses elsewhere, each as "<script src> from cdn.example". Comments and inline scripts' and styles'
 * contents are left out first (Next's inline data repeats markup as data, which loads nothing); an address is resolved
 * against `origin`, so "/x.js" and "https://<origin>/x.js" are the site's own and "//cdn.example/x.js" isn't. Only
 * http(s) addresses count (data: and blob: belong to the page itself; the Content-Security-Policy bounds the rest). Links a
 * reader follows (<a href>) load nothing.
 */
export function foreignResourcesInHtml(html: string, origin: string): string[] {
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, "<$1$2></$1>");
  let own: string;
  try {
    own = new URL(origin).origin;
  } catch {
    return [`the page's own address ${origin} couldn't be read`];
  }
  const out: string[] = [];
  const check = (what: string, value: string | null | undefined) => {
    if (!value) return;
    let url: URL;
    try {
      url = new URL(value.trim(), own);
    } catch {
      return;
    }
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== own) out.push(`${what} from ${url.host}`);
  };
  for (const m of markup.matchAll(TAG)) {
    if (m[1]) continue;
    const name = (m[2] as string).toLowerCase();
    const attrs = attributesOf(m[3] ?? "");
    if (name === "script" || name === "iframe" || name === "frame" || name === "embed") check(`<${name} src>`, attrs.get("src"));
    else if (name === "object") check("<object data>", attrs.get("data"));
    else if (name === "base") check("<base href>", attrs.get("href"));
    else if (name === "link") {
      const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
      const kind = rel.find((r) => FETCHING_LINKS.has(r));
      if (kind) check(`<link rel=${kind}>`, attrs.get("href"));
    }
  }
  return out;
}

/** The sentence before a card's "Values: FantasyCalc" link (tradeView.ts VALUES_CREDIT_TEXT; the planner's attribution, 5.4). */
export const VALUES_CREDIT = "These numbers weigh each player's trade value.";

/** A card's credit as the page has it: the words before the link, and the link. */
export interface CreditRead {
  lead: string;
  link: { href: string | null; rel: string | null; referrerPolicy: string | null; text: string; last: boolean } | null;
}

/** What's wrong with a card's credit (pure): VALUES_CREDIT, then the "Values: FantasyCalc" link with FantasyCalc's attributes, last. */
export function creditProblems(credit: CreditRead | null): string[] {
  if (!credit) return [`no "${VALUES_CREDIT}" line with a FantasyCalc link`];
  const out: string[] = [];
  if (credit.lead !== VALUES_CREDIT) out.push(`the line before the link reads "${credit.lead}"`);
  const l = credit.link;
  if (!l) return [...out, "no link after the sentence"];
  if (l.text !== "Values: FantasyCalc") out.push(`the link reads "${l.text}"`);
  if (!l.last) out.push("something follows the link");
  out.push(...fantasyCalcLinkIssues([{ href: l.href ?? "", rel: l.rel, referrerPolicy: l.referrerPolicy, inFooter: false, hiddenBy: null }], { requireFooter: false }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The Trade Finder's freshness line (§5.3)

/** tradeView.ts timeAgoText's wordings. */
const AGO = String.raw`(?:just now|yesterday|\d+ (?:minute|hour|day)s? ago)`;
const FRESHNESS = new RegExp(String.raw`^(?:Trade values updated ${AGO}(?: · Projections updated ${AGO})?|Projections updated ${AGO})\.$`);

/** Whether a line is the Trade Finder's freshness line (pure): "Trade values updated 2 hours ago · Projections updated 5 hours ago." or either part alone. */
export function freshnessLineOk(text: string): boolean {
  return FRESHNESS.test(text.replace(/\s+/g, " ").trim());
}

// ---------------------------------------------------------------------------------------------
// Settings: the automatic playoff weight (§6.1)

export type PlayoffWeightState = "waiting" | "working" | "auto" | "default" | "other";

/**
 * The Settings page's "Playoff weeks count:" value read (pure; settingsView.ts playoffWeightView): "waiting" (no fresh
 * inputs yet: "… when the League page loads."), "working" ("… Working it out…"), "auto" ("1.6×, set automatically from
 * your odds."), "default" ("1.3× (the default: <why>)."), or "other"; with the weight when it shows one.
 */
export function playoffWeightRead(value: string): { state: PlayoffWeightState; weight: number | null } {
  const v = value.replace(/\s+/g, " ").trim();
  const auto = /^(\d+\.\d)×, set automatically from your odds\.$/.exec(v);
  if (auto) return { state: "auto", weight: Number(auto[1]) };
  const fallback = /^(\d+\.\d)× \(the default: [^()]+\)\.$/.exec(v);
  if (fallback) return { state: "default", weight: Number(fallback[1]) };
  if (/Working it out…$/.test(v)) return { state: "working", weight: null };
  if (/when the League page loads\.$/.test(v)) return { state: "waiting", weight: null };
  return { state: "other", weight: null };
}

/** The weight's range (the planner's clamp, §6.1: [0.5, 4]). */
export const PLAYOFF_WEIGHT_RANGE = [0.5, 4] as const;

// ---------------------------------------------------------------------------------------------
// The waiver view and the header (§6.2)

/** The waiver view's toggle as it may read: two lists, or three while a week is under way with games left. */
const WAIVER_TOGGLES: ReadonlyArray<{ labels: readonly string[]; kind: "two" | "three" }> = [
  { labels: ["Rest of season", "This week"], kind: "two" },
  { labels: ["Rest of season", "Next week"], kind: "two" },
  { labels: ["Rest of season", "This week", "Next week"], kind: "three" },
];

/** Which toggle the labels are (pure), or null when they're none of the allowed ones. */
export function waiverToggleKind(labels: readonly string[]): "two" | "three" | null {
  return WAIVER_TOGGLES.find((t) => t.labels.length === labels.length && t.labels.every((l, i) => l === labels[i]))?.kind ?? null;
}

/**
 * How many rows boxes sit in (pure): a box whose middle falls within a row's first box shares that row (boxes a pixel
 * apart, or touching, are rows of their own).
 */
export function rowCount(boxes: ReadonlyArray<{ top: number; bottom: number }>): number {
  const rows: Array<{ top: number; bottom: number }> = [];
  for (const b of [...boxes].sort((x, y) => x.top - y.top)) {
    const middle = (b.top + b.bottom) / 2;
    if (!rows.some((r) => middle >= r.top && middle <= r.bottom)) rows.push({ top: b.top, bottom: b.bottom });
  }
  return rows.length;
}

/** The header's links at 375 px (SiteHeader.tsx, Phase 7b): six, the last one added the Waivers link. */
export const NAV_HREFS = ["/connect", "/import", "/league", "/league#waivers", "/trades", "/settings"] as const;

// ---------------------------------------------------------------------------------------------
// Requests (the Analyzer's "Back to the Trade Finder" isn't prefetched)

/**
 * Whether a request asks for the page at `href` (pure): its path (or one of Next's files for it, "/trades.rsc",
 * "/trades.segments/…"), with every query value `href` carries (a prefetch or a navigation adds _rsc and keeps them).
 * A request without `href`'s team id doesn't name its address: that id is what must reach the server only when opened.
 */
export function requestNamesAddress(url: string, href: string): boolean {
  let u: URL;
  let h: URL;
  try {
    u = new URL(url, "http://check.invalid");
    h = new URL(href, "http://check.invalid");
  } catch {
    return false;
  }
  const want = h.pathname.replace(/\/$/, "") || "/";
  const path = u.pathname;
  if (!(path === want || path.startsWith(`${want}.`) || path.startsWith(`${want}/`))) return false;
  for (const [key, value] of h.searchParams) if (!u.searchParams.getAll(key).includes(value)) return false;
  return true;
}
