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
 * Planner reply to Checkpoint 7b, §6 (league prizes; Checkpoint 7c): the Settings page's "Your league's prizes" under
 * "Several prizes" (prizeGroupProblems, invalidPrizeProblems), and "Top 3 odds" (or "Top 2 odds") on the cards and in the
 * League page's headline exactly when the league's split pays 3rd (2nd) place (oddsLabelProblems, headlineTopProblems).
 * §7 ("Helps both"; Checkpoint 7c): the tag on exactly the cards that help both teams as printed (helpsBothTagProblems,
 * cardHelpsBoth), the "Helps both" list holding only those (helpsBothListProblems) with its status line
 * (helpsBothStatusOk), and the partner's line's odds in the format of mine (oddsLabelProblems with `whose` "theirs").
 *
 * Planner reply to Checkpoint 7c (Checkpoint 7d): "Helps both" needs Helps you of at least the bar too (answer 5:
 * cardHelpsBoth); a Trade Finder card shows the partner's line exactly when it's tagged, never on an "If they say no, try:" box
 * (answer 3: finderPartnerLineProblems), and the Analyzer's card shows it whatever it is (analyzerPartnerLineProblems); every
 * app page's footer links "DynastyProcess" to its data repository (dynastyProcessLinksInHtml, dynastyProcessLinkIssues, on the
 * server's own HTML like FantasyCalc's).
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
  return linksInHtml(html, isFantasyCalcHref).map((l) => ({ href: l.href, rel: l.rel, referrerPolicy: l.referrerPolicy, inFooter: l.inFooter, hiddenBy: l.hiddenBy }));
}

/** A link in a page's server HTML (linksInHtml): FantasyCalcLink's fields, and the words it shows (tags left out, entities read). */
export interface HtmlLink extends FantasyCalcLink {
  text: string;
}

/**
 * Every link in a page's server HTML whose address `wanted` takes (pure; fantasyCalcLinksInHtml's reading, and since
 * Checkpoint 7d DynastyProcess's): each with its rel and referrerpolicy, whether a <footer> holds it, what hides it if
 * anything, and its words. Comments, scripts and styles are left out first; React writes every end tag, so the open
 * elements are a plain stack, and a link's words run to its own end tag (links don't nest).
 */
export function linksInHtml(html: string, wanted: (href: string | null | undefined) => boolean): HtmlLink[] {
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const open: Array<{ name: string; hides: string | null }> = [];
  const links: HtmlLink[] = [];
  for (const m of markup.matchAll(TAG)) {
    const name = (m[2] as string).toLowerCase();
    if (m[1]) {
      const at = open.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) open.length = at;
      continue;
    }
    const attrs = attributesOf(m[3] ?? "");
    const self = { name, hides: hides(name, attrs) };
    if (name === "a" && wanted(attrs.get("href"))) {
      const from = m.index + m[0].length;
      const end = markup.indexOf("</a", from);
      const inner = end >= 0 ? markup.slice(from, end) : "";
      links.push({
        href: (attrs.get("href") ?? "").trim(),
        rel: attrs.get("rel") ?? null,
        referrerPolicy: attrs.get("referrerpolicy") ?? null,
        inFooter: open.some((e) => e.name === "footer"),
        hiddenBy: [...open, self].find((e) => e.hides)?.hides ?? null,
        text: decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(),
      });
    }
    if (!VOID.has(name) && !m[4]) open.push(self);
  }
  return links;
}

/**
 * DynastyProcess's data repository, where the footer's "DynastyProcess" credit links (Checkpoint 7d; planner reply to
 * Checkpoint 7c, "Also": "Link “DynastyProcess” in the footer to its data repository": its ID pairs reach the browser, so its
 * GPL-3.0 license is credited where users can see it).
 */
export const DYNASTYPROCESS_DATA_URL = "https://github.com/dynastyprocess/data";

/** An address on DynastyProcess's GitHub, any repository of theirs (so a link that strays from the data repository is still checked). */
export function isDynastyProcessHref(href: string | null | undefined): boolean {
  return typeof href === "string" && /^https?:\/\/(?:www\.)?github\.com\/dynastyprocess(?:[/?#]|$)/i.test(href.trim());
}

/** Every link to DynastyProcess in a page's server HTML (pure; linksInHtml). */
export function dynastyProcessLinksInHtml(html: string): HtmlLink[] {
  return linksInHtml(html, isDynastyProcessHref);
}

/**
 * What's wrong with a page's DynastyProcess credit (pure; the lead's decisions for Checkpoint 7d): its footer has a link that
 * reads "DynastyProcess", shown without JavaScript, to exactly DYNASTYPROCESS_DATA_URL, with rel exactly "noopener" (⚠️ the
 * lead's, like the other outbound links: the site's Referrer-Policy same-origin already sends no referrer). Each footer link
 * to DynastyProcess is checked; one elsewhere doesn't stand in for the footer's.
 */
export function dynastyProcessLinkIssues(links: readonly HtmlLink[]): string[] {
  const footer = links.filter((l) => l.inFooter);
  if (!footer.length) return ["no link to DynastyProcess's data in the footer"];
  return footer.flatMap((l, i) => {
    const which = `the footer's DynastyProcess link${footer.length > 1 ? ` ${i + 1}` : ""}`;
    const out: string[] = [];
    if (l.href !== DYNASTYPROCESS_DATA_URL) out.push(`${which} goes to ${l.href}, not ${DYNASTYPROCESS_DATA_URL}`);
    if ((l.rel ?? "").trim() !== "noopener") out.push(`${which}: rel ${l.rel === null ? "is missing" : `is "${l.rel}"`}, not exactly "noopener"`);
    if (l.text !== "DynastyProcess") out.push(`${which} reads "${l.text}", not "DynastyProcess"`);
    if (l.hiddenBy) out.push(`${which} is hidden without JavaScript (inside ${l.hiddenBy})`);
    return out;
  });
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
// League prizes (Checkpoint 7c; planner reply to Checkpoint 7b, §6)

/** "Your league's prizes" as the page shows it under "Several prizes" (inPage.ts READ_SETTINGS_PRIZES). */
export interface PrizeGroupRead {
  /** The group's description (its fieldset's aria-describedby), or null. */
  help: string | null;
  /**
   * Each field: its label, its value, its height (px), its aria-invalid, the text its aria-describedby names, and whether
   * that text sits in a live region (aria-live), so it's announced as it shows (review of the prizes UI, prizes-ui-3).
   */
  fields: Array<{ label: string; value: string; height: number; invalid: string | null; error: string | null; live: boolean }>;
  /** "Your prizes split: …", or null. */
  split: string | null;
  /** "Enter at least one prize. …", or null. */
  warning: string | null;
  /** How many labels the goal's own group ("What does your league reward?") holds: its three answers. */
  goalLabels: number;
}

/**
 * What's wrong with "Your league's prizes" (pure; settingsView.ts SettingsView.prizes, SettingsForm.tsx PrizesGroup), each in
 * words: missing; its help not the planner's line (`want.help`); its fields not the five labels in order (`want.labels`),
 * not reading the saved amounts (`want.values`), under 44 px or marked invalid; the split not the app's own for the saved
 * amounts (`want.split`, null for none: then the warning shows instead); and the goal's group with more than its three
 * labeled answers (the prizes are a sibling group, so the goal's reader keeps working).
 */
export function prizeGroupProblems(read: PrizeGroupRead | null, want: { labels: readonly string[]; help: string; values: readonly string[]; split: string | null }): string[] {
  if (!read) return ["no “Your league's prizes” group shows under “Several prizes”"];
  const out: string[] = [];
  const quote = (xs: readonly string[]) => xs.map((x) => `“${x}”`).join(", ") || "none";
  if (read.help !== want.help) out.push(`its help reads ${read.help === null ? "nothing" : `“${read.help}”`}, not the planner's line`);
  const labels = read.fields.map((f) => f.label);
  if (labels.length !== want.labels.length || labels.some((l, i) => l !== want.labels[i])) out.push(`its fields are ${quote(labels)}, not ${quote(want.labels)}`);
  const values = read.fields.map((f) => f.value);
  if (values.length !== want.values.length || values.some((v, i) => v !== want.values[i])) out.push(`its fields read ${quote(values)}, not the saved ${quote(want.values)}`);
  for (const f of read.fields) {
    if (!(f.height >= 43.5)) out.push(`“${f.label}” is ${f.height} px tall (44 px at least)`);
    if (f.invalid === "true") out.push(`“${f.label}” is marked invalid with nothing typed`);
  }
  if (read.split !== want.split) out.push(`the split reads ${read.split === null ? "nothing" : `“${read.split}”`}, not ${want.split === null ? "nothing" : `“${want.split}”`}`);
  if (want.split === null && read.warning === null) out.push("nothing says the amounts add up to nothing");
  if (read.goalLabels !== 3) out.push(`the goal's group holds ${read.goalLabels} labels, not its three answers`);
  return out;
}

/**
 * What's wrong with a prize field after text it can't read was typed and it lost focus (pure): it must say so, aria-invalid
 * "true" and its message (`message`, settingsView.ts PRIZE_TEXT_MESSAGES) linked by aria-describedby, in a live region (the
 * message shows on blur, after focus has moved on: review of the prizes UI, prizes-ui-3).
 */
export function invalidPrizeProblems(field: PrizeGroupRead["fields"][number] | undefined, message: string): string[] {
  if (!field) return ["the field is gone"];
  const out: string[] = [];
  if (field.invalid !== "true") out.push(`aria-invalid is ${field.invalid === null ? "missing" : `“${field.invalid}”`}`);
  if (field.error !== message) out.push(`its message reads ${field.error === null ? "nothing" : `“${field.error}”`}, not “${message}”`);
  else if (!field.live) out.push("its message isn't in a live region, so a screen reader doesn't announce it");
  return out;
}

/**
 * The odds lines on a card or a Plan B box (pure; src/lib/tradeView.ts oddsViews), each list of labels in its order:
 * "Title odds", then "Top 3 odds" ("Top 2 odds") when the league's split pays 3rd (2nd) place under "Several prizes"
 * (`places`, tradeView.ts topPlacesOf), then "Playoff odds". Each list that reads otherwise, in words (`where` names it).
 * `whose` "theirs" (Checkpoint 7c, planner reply to Checkpoint 7b, §7: the partner's line, "in the same format as yours";
 * tradeView.ts theirOddsViews): the same labels for them, "Their title odds", "Their top 3 odds", "Their playoff odds".
 */
export function oddsLabelProblems(lists: ReadonlyArray<readonly string[]>, places: 2 | 3 | null, where: (i: number) => string = (i) => `odds line ${i + 1}`, whose: "mine" | "theirs" = "mine"): string[] {
  const mine = ["Title odds", ...(places ? [`Top ${places} odds`] : []), "Playoff odds"];
  const want = whose === "theirs" ? mine.map((l) => `Their ${l.charAt(0).toLowerCase()}${l.slice(1)}`) : mine;
  return lists.flatMap((labels, i) => (labels.length === want.length && labels.every((l, j) => l === want[j]) ? [] : [`${where(i)}: ${labels.map((l) => `“${l}”`).join(" · ") || "no labels"}`]));
}

// ---------------------------------------------------------------------------------------------
// "Helps both" (Checkpoint 7c; planner reply to Checkpoint 7b, §7)

/** A card's "Helps both" parts as the page shows them (inPage.ts cardData). */
export interface HelpsBothCardRead {
  /** Helps you as printed ("39", "0", "—"). */
  helps: string | null;
  /** Helps them as printed on the partner's line ("24", "0"), null without the line. */
  helpsThem: string | null;
  /** The "Helps both" tag shows with the card's heading. */
  helpsBothTag: boolean;
  /** Checkpoint 7d: the card's "If they say no, try:" box shows a partner's line of its own (it never may); absent: no box read. */
  planBHelpsThem?: boolean;
}

/** A printed score as a number (pure): "39" → 39; "—", text or nothing → null. */
function printedScore(v: string | null): number | null {
  return v !== null && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
}

/**
 * Whether a card helps both teams on the numbers it prints (pure; benefit.ts helpsBoth, the lead's call: on the printed
 * scores): Helps you and Helps them each at least `min` (config.benefit.helpsThemMin, which the steps pass: this file
 * imports nothing; Helps you since Checkpoint 7d, planner reply to Checkpoint 7c, answer 5: "the same bar as Helps them").
 * ⚠️ Since answer 3 a Trade Finder card shows Helps them only when it helps both, so there a card without the partner's line
 * reads as not helping both, whatever its own numbers: finderPartnerLineProblems holds the line and the tag together.
 */
export function cardHelpsBoth(card: Pick<HelpsBothCardRead, "helps" | "helpsThem">, min: number): boolean {
  const mine = printedScore(card.helps);
  const theirs = printedScore(card.helpsThem);
  return mine !== null && mine >= min && theirs !== null && theirs >= min;
}

/**
 * The partner's line on the Trade Finder's cards (pure; Checkpoint 7d, planner reply to Checkpoint 7c, answer 3: "show “Helps
 * them” and their odds only on cards that help both"; tradeView.ts CardContext.partnerLine): a card shows it exactly when it
 * carries the "Helps both" tag, and an "If they say no, try:" box never shows one (Checkpoint 7c's rule: a box carries no
 * partner's numbers). Each card that reads otherwise, in words (`where` names it).
 */
export function finderPartnerLineProblems(cards: ReadonlyArray<HelpsBothCardRead>, where: (i: number) => string = (i) => `idea ${i + 1}`): string[] {
  return cards.flatMap((c, i) => {
    const out: string[] = [];
    if (c.helpsThem !== null && !c.helpsBothTag) out.push(`${where(i)} shows “Helps them ${c.helpsThem}” without the “Helps both” tag`);
    if (c.helpsThem === null && c.helpsBothTag) out.push(`${where(i)} is tagged “Helps both” without the partner's line`);
    if (c.planBHelpsThem) out.push(`${where(i)}'s “If they say no, try:” shows a partner's line`);
    return out;
  });
}

/**
 * The partner's line on the Trade Analyzer's card (pure; Checkpoint 7d, planner reply to Checkpoint 7c, answer 3: "The Analyzer
 * always shows them, including when the trade hurts the other team"): it shows Helps them (a whole number, "0" when the trade
 * costs them); when the Trade Finder's card for the same trade showed the line too, the same number; and the same tag as that
 * card. Each way it reads otherwise, in words.
 */
export function analyzerPartnerLineProblems(analyzer: HelpsBothCardRead, finder: Pick<HelpsBothCardRead, "helpsThem" | "helpsBothTag"> | null): string[] {
  const out: string[] = [];
  if (printedScore(analyzer.helpsThem) === null) out.push(analyzer.helpsThem === null ? "the Analyzer's card has no partner's line" : `the Analyzer's card reads “Helps them ${analyzer.helpsThem}”`);
  if (finder && finder.helpsThem !== null && analyzer.helpsThem !== finder.helpsThem) out.push(`the Analyzer's card reads Helps them ${analyzer.helpsThem ?? "none"}, the Trade Finder's ${finder.helpsThem}`);
  if (finder && analyzer.helpsBothTag !== finder.helpsBothTag) out.push(`the Analyzer's card is ${analyzer.helpsBothTag ? "" : "not "}tagged “Helps both”, the Trade Finder's ${finder.helpsBothTag ? "is" : "isn't"}`);
  return out;
}

/**
 * The tag (pure; tradeView.ts helpsBothTagOf: "cards that help both get a small “Helps both” tag in every sort"): on exactly
 * the cards that help both teams as printed (cardHelpsBoth). Each card that reads otherwise, in words (`where` names it).
 */
export function helpsBothTagProblems(cards: ReadonlyArray<HelpsBothCardRead>, min: number, where: (i: number) => string = (i) => `idea ${i + 1}`): string[] {
  return cards.flatMap((c, i) => {
    const both = cardHelpsBoth(c, min);
    if (c.helpsBothTag === both) return [];
    const numbers = `Helps you ${c.helps ?? "none"}, Helps them ${c.helpsThem ?? "none"}`;
    return [c.helpsBothTag ? `${where(i)} shows “Helps both” at ${numbers}` : `${where(i)} has no “Helps both” tag at ${numbers}`];
  });
}

/**
 * The "Helps both" list (pure; the planner: "It shows only trades that help both teams"): every card helps both on its printed
 * numbers and carries the tag. Each card that doesn't, in words.
 */
export function helpsBothListProblems(cards: ReadonlyArray<HelpsBothCardRead>, min: number, where: (i: number) => string = (i) => `idea ${i + 1}`): string[] {
  return cards.flatMap((c, i) =>
    cardHelpsBoth(c, min) && c.helpsBothTag ? [] : [`${where(i)} is on the “Helps both” list at Helps you ${c.helps ?? "none"}, Helps them ${c.helpsThem ?? "none"}${c.helpsBothTag ? "" : ", untagged"}`],
  );
}

/**
 * The Trade Finder's status line under "Helps both" (pure; tradeView.ts buildFinderView, the lead's words): "Found 4 trade
 * ideas that help both teams." ("Found 1 trade idea that helps both teams.") for the cards shown, "No trades help both teams
 * right now." with none.
 */
export function helpsBothStatusOk(status: string, cards: number): boolean {
  if (cards === 0) return status === "No trades help both teams right now.";
  return status === `Found ${cards} ${cards === 1 ? "trade idea that helps" : "trade ideas that help"} both teams.`;
}

/**
 * My odds' lines on the League page (pure; leagueView.ts myOddsOf: "Your odds: 60% playoffs · 30% top 3 · 10.5% title"):
 * a top-N part exactly when `places`, the one it names, once a line; each line that reads otherwise, in words.
 */
export function headlineTopProblems(lines: readonly string[], places: 2 | 3 | null): string[] {
  return lines.flatMap((line) => {
    const tops = [...line.matchAll(/\btop (\d)\b/g)].map((m) => Number(m[1]));
    if (places === null) return tops.length ? [`“${line}” shows a top-${tops[0]} chance, though your league's prizes pay no 2nd or 3rd place`] : [];
    return tops.length === 1 && tops[0] === places ? [] : [`“${line}” lacks one top-${places} chance`];
  });
}

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
