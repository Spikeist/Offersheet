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
 * - 6.2: the waiver view's toggle (waiverToggleKind), and the header's six links in two rows at 375 px (rowCount); since
 *   Checkpoint 7e (planner reply to Checkpoint 7d, items 3.1–3.4) each of its rows read as one move, with Helps you on the
 *   rated "Rest of season" and a lock next to each drop (waiverMoveProblems).
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
 * cardHelpsBoth); a Trade Finder card shows the partner's line exactly when it's tagged, never on a Plan B box ("If they won't move: try …")
 * (answer 3: finderPartnerLineProblems), and the Analyzer's card shows it whatever it is, tagged as its own scores call for
 * (analyzerPartnerLineProblems: the one card that prints both scores of an untagged idea); every
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
 * lead's, like FantasyCalc's links; the privacy page's links add "noreferrer", which adds nothing here: the site's
 * Referrer-Policy, same-origin, already sends another site no referrer; review of Checkpoint 7d, PD7D-6). Each footer link
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
  /** Checkpoint 7d: the card's Plan B box ("If they won't move: try …" since Checkpoint 7e) shows a partner's line of its own (it never may); absent: no box read. */
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
 * carries the "Helps both" tag, and a Plan B box ("If they won't move: try …") never shows one (Checkpoint 7c's rule: a box carries no
 * partner's numbers). Each card that reads otherwise, in words (`where` names it).
 */
export function finderPartnerLineProblems(cards: ReadonlyArray<HelpsBothCardRead>, where: (i: number) => string = (i) => `idea ${i + 1}`): string[] {
  return cards.flatMap((c, i) => {
    const out: string[] = [];
    if (c.helpsThem !== null && !c.helpsBothTag) out.push(`${where(i)} shows “Helps them ${c.helpsThem}” without the “Helps both” tag`);
    if (c.helpsThem === null && c.helpsBothTag) out.push(`${where(i)} is tagged “Helps both” without the partner's line`);
    if (c.planBHelpsThem) out.push(`${where(i)}'s “If they won't move: try …” shows a partner's line`);
    return out;
  });
}

/**
 * The partner's line on the Trade Analyzer's card (pure; Checkpoint 7d, planner reply to Checkpoint 7c, answer 3: "The Analyzer
 * always shows them, including when the trade hurts the other team"): it shows Helps them (a whole number, "0" when the trade
 * costs them); when the Trade Finder's card for the same trade showed the line too, the same number; the same tag as that
 * card; and the tag its own printed scores call for (helpsBothTagProblems at `min`, config.benefit.helpsThemMin, which the
 * step passes). The last because a Finder card shows Helps them only with the tag: an untagged one reads as not helping both
 * whatever its numbers, so a trade that helps both but that the page tags nowhere passes every Finder check, and only the
 * Analyzer's card, which prints both scores, shows it (review of Checkpoint 7d, cards-export-3). Each way it reads otherwise,
 * in words.
 */
export function analyzerPartnerLineProblems(analyzer: HelpsBothCardRead, finder: Pick<HelpsBothCardRead, "helpsThem" | "helpsBothTag"> | null, min: number): string[] {
  const out: string[] = [];
  if (printedScore(analyzer.helpsThem) === null) out.push(analyzer.helpsThem === null ? "the Analyzer's card has no partner's line" : `the Analyzer's card reads “Helps them ${analyzer.helpsThem}”`);
  if (finder && finder.helpsThem !== null && analyzer.helpsThem !== finder.helpsThem) out.push(`the Analyzer's card reads Helps them ${analyzer.helpsThem ?? "none"}, the Trade Finder's ${finder.helpsThem}`);
  if (finder && analyzer.helpsBothTag !== finder.helpsBothTag) out.push(`the Analyzer's card is ${analyzer.helpsBothTag ? "" : "not "}tagged “Helps both”, the Trade Finder's ${finder.helpsBothTag ? "is" : "isn't"}`);
  out.push(...helpsBothTagProblems([analyzer], min, () => "the Analyzer's card"));
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
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2): a card's "now or after this week" line as the page shows it
 * (inPage.ts nowOrLaterOf): its Helps you tile, the line's words as seen and its tooltip (null: no line), and the words of the
 * card's fact for it (null: none).
 */
export interface NowOrLaterRead {
  helps: string | null;
  line: { text: string; title: string | null } | null;
  fact: string | null;
}

/** The line's words: "Helps you 37 now · 41 if done after this week's games." */
export const NOW_OR_LATER_LINE = /^Helps you (\d+) now · (\d+) if done after this week's games\.$/;

/**
 * What's wrong with the cards' "now or after this week" lines (Checkpoint 7e, item 4.2): a line reads as NOW_OR_LATER_LINE,
 * starts from its card's own Helps you, shows only when the two differ by more than `min` (config.explain.nowOrLaterMin), with
 * `title` (the planner's words) as its tooltip and the same words as the card's fact, which a phone shows; no such fact without
 * a line. Empty when every card is right.
 */
export function nowOrLaterProblems(cards: readonly NowOrLaterRead[], want: { min: number; title: string }, where: (i: number) => string = (i) => `idea ${i + 1}`): string[] {
  const out: string[] = [];
  cards.forEach((c, i) => {
    if (!c.line) {
      if (c.fact !== null) out.push(`${where(i)} explains a later line it doesn't show`);
      return;
    }
    const m = NOW_OR_LATER_LINE.exec(c.line.text);
    if (!m) {
      out.push(`${where(i)}'s line reads “${c.line.text}”`);
      return;
    }
    const now = Number(m[1]);
    const later = Number(m[2]);
    if (String(now) !== c.helps) out.push(`${where(i)}'s line starts from ${now}, its Helps you is ${c.helps ?? "missing"}`);
    if (!(Math.abs(now - later) > want.min)) out.push(`${where(i)}'s line shows ${now} and ${later}, within ${want.min} of each other`);
    if (c.line.title !== want.title) out.push(`${where(i)}'s line has the tooltip “${c.line.title ?? "(none)"}”`);
    if (c.fact !== want.title) out.push(`${where(i)}'s facts say “${c.fact ?? "(nothing)"}” for the later line`);
  });
  return out;
}

/** One offer of a card's "How to offer it" as the page prints it (Checkpoint 7e; inPage.ts offersData). */
export interface OfferRead {
  /** Its label: "Open with", "Then", "The suggested trade" ("The trade you built" in the Analyzer), "Last offer". */
  label: string;
  /** Helps you as printed ("50", "0", "—"), null when the line can't be read. */
  helps: string | null;
  /** The chance they accept as printed ("15%", "<5%"), null when the line can't be read. */
  chance: string | null;
  /**
   * The chance it goes through as its veto note prints it ("Counting a league veto vote, about 20% it goes through." → "20%",
   * "under 5%" → "<5%"), null without a note: the chance the ladder's rules read when it's there (offers.ts: P_complete).
   */
  through?: string | null;
  /** Its own "Message to send them" has a Copy button. */
  copy: boolean;
  /** Its trade key (the item's data-offer-key: TradeCard.tsx), null when the item carries none. */
  key?: string | null;
  /** Its "Also shown as trade idea N." line (the lead's call for Checkpoint 7e's wave D: an offer that is another card shown), else null. */
  also?: string | null;
}

/** An offer's veto note read into a printed chance (pure): "…, about 20% it goes through." → "20%", "…, under 5% it goes through." → "<5%"; else null. */
export function throughOf(note: string | null | undefined): string | null {
  const m = /(?:about (\d{1,3})%|under 5%) it goes through/.exec(note ?? "");
  if (!m) return null;
  return m[1] ? `${m[1]}%` : "<5%";
}

/** The opened "How to offer it" (inPage.ts offersData): its status line, its offers in order, and whether it shows a failure. */
export interface OffersRead {
  status: string;
  offers: OfferRead[];
  failed: boolean;
}

/** A chance as printed, in whole percents (pure): "15%" → 15, "<5%" → 0 (under the display's step); anything else → null. */
export function printedChancePoints(v: string | null): number | null {
  if (v === null) return null;
  const m = /^(<)?(\d{1,3})%$/.exec(v.trim());
  if (!m) return null;
  return m[1] ? 0 : Number(m[2]);
}

/** The words "How to offer it" says when nothing makes a better first offer (tradeView.ts offersAloneText). */
export const OFFERS_ALONE = /^Offer this trade as it is: no version of it with .+ makes a better first offer\.$/;

/**
 * "How to offer it" on the numbers it prints (pure; Checkpoint 7e, planner reply to Checkpoint 7d, item 4.1, the lead's
 * check:browser bullet: "Open at least 15%, each step at least 5 points likelier, Helps you above 0 and not rising, every
 * step's Copy button"): it answered (no failure, not still working); with offers, they read "Open with" (at most one, first),
 * "Then" (any), the suggested trade (exactly one: `suggested`, its label on this page) and "Last offer" (at most one, last), in
 * that order; the opening offer prints at least `openMin` percent; each offer prints a chance at least `gain` points above the
 * one before; every Helps you is a number above 0 and none above the one before; every offer has its own Copy button. With
 * none, its line says to offer the trade as it is (OFFERS_ALONE). The chances compared are the ones the ladder's rules read
 * (the review of wave D, UI-D-3): the chance it goes through when its veto note prints one (`through`), else the chance they
 * accept. `openMin` and `gain` are whole percents (config.offers.
 * openMinChance, or the minimum chance when that's higher; config.search.steps.minAcceptGain), which the step passes: this
 * file imports nothing. Each rule broken, in words.
 */
export function offersProblems(read: OffersRead, want: { openMin: number; gain: number; suggested: readonly string[] }): string[] {
  if (read.failed) return ["“How to offer it” says the offers couldn't be worked out"];
  if (!read.offers.length) return OFFERS_ALONE.test(read.status) ? [] : [`“How to offer it” shows no offers and says “${read.status}”`];
  const out: string[] = [];
  const kind = (label: string) => (label === "Open with" ? "o" : label === "Then" ? "t" : want.suggested.includes(label) ? "s" : label === "Last offer" ? "l" : "?");
  const order = read.offers.map((o) => kind(o.label)).join("");
  if (!/^o?t*sl?$/.test(order)) out.push(`its offers read ${read.offers.map((o) => `“${o.label}”`).join(", ")}, not Open with, Then, the suggested trade and Last offer in that order`);
  read.offers.forEach((o, i) => {
    const name = `offer ${i + 1} (“${o.label}”)`;
    const helps = o.helps !== null && /^\d+$/.test(o.helps) ? Number(o.helps) : null;
    // The chance the rules read: the one it goes through when its veto note prints it, else the chance they accept.
    const shown = o.through ?? o.chance;
    const chance = printedChancePoints(shown);
    if (helps === null || helps <= 0) out.push(`${name} reads Helps you ${o.helps ?? "none"}, not above 0`);
    if (chance === null) out.push(`${name}'s chance they accept reads “${o.chance ?? "none"}”`);
    if (i === 0 && o.label === "Open with" && chance !== null && chance < want.openMin) out.push(`${name} prints ${shown}, under ${want.openMin}%`);
    const prev = read.offers[i - 1];
    if (prev) {
      const prevShown = prev.through ?? prev.chance;
      const before = printedChancePoints(prevShown);
      const helpsBefore = prev.helps !== null && /^\d+$/.test(prev.helps) ? Number(prev.helps) : null;
      if (chance !== null && before !== null && chance < before + want.gain) out.push(`${name} prints ${shown}, not ${want.gain} points above offer ${i}'s ${prevShown}`);
      if (helps !== null && helpsBefore !== null && helps > helpsBefore) out.push(`${name}'s Helps you ${o.helps} is above offer ${i}'s ${prev.helps}`);
    }
    if (!o.copy) out.push(`${name} has no Copy button for its message`);
  });
  return out;
}

/**
 * "How to offer it"'s offers that are other cards (pure; the lead's call for Checkpoint 7e's wave D: an offer can be another
 * card of its list, and then says so, Plan B's words, TradeCard.tsx): each offer whose key is one of `places` (the list's
 * cards by key, each its place, 1 = first: inPage.ts cardPlaces) reads "Also shown as trade idea N." with that card's place;
 * the suggested trade (its label one of `suggested`: the card itself) and every other offer read none. An offer with no key
 * can't be checked: said so. Each that doesn't, in words.
 */
export function offersAlsoProblems(read: Pick<OffersRead, "offers">, places: Readonly<Record<string, number>>, suggested: readonly string[]): string[] {
  const out: string[] = [];
  read.offers.forEach((o, i) => {
    const name = `offer ${i + 1} (“${o.label}”)`;
    if (!o.key) {
      out.push(`${name} carries no key to compare with the ideas shown`);
      return;
    }
    const place = suggested.includes(o.label) ? undefined : places[o.key];
    const want = place === undefined ? null : `Also shown as trade idea ${place}.`;
    const got = o.also ?? null;
    if (want !== got) out.push(want === null ? `${name} reads “${got}”, though ${suggested.includes(o.label) ? "it's the idea itself" : "no idea shown is its trade"}` : `${name} is trade idea ${place} but reads ${got === null ? "no “Also shown as trade idea …”" : `“${got}”`}`);
  });
  return out;
}

/**
 * Merged ideas (pure; Checkpoint 7f, planner reply to Checkpoint 7e, decision 3: "When one card's offer list contains another
 * card's trade, merge them: Keep only the card with the higher Overall in the list"; the lead's check:browser bullet): in the
 * Overall sort, an idea's offers include no other idea of the list below it (`places`: the list's cards by key, each its place,
 * 1 = first: inPage.ts cardPlaces; `cardKey`, the idea's own), since the merge would have shown that one among this idea's
 * offers only. One above it can stay, labeled (it can't offer this one back: offersAlsoProblems checks its label). The
 * suggested trade (its label one of `suggested`) is the idea itself. Each that breaks it, in words.
 */
export function offersMergeProblems(read: Pick<OffersRead, "offers">, places: Readonly<Record<string, number>>, cardKey: string, suggested: readonly string[]): string[] {
  const own = places[cardKey];
  if (own === undefined) return ["the idea isn't among the ideas shown"];
  const out: string[] = [];
  read.offers.forEach((o, i) => {
    if (suggested.includes(o.label) || !o.key) return;
    const place = places[o.key];
    if (place !== undefined && place > own) out.push(`offer ${i + 1} (“${o.label}”) is trade idea ${place}, below this one (${own}) on Overall, which should show it among this idea's offers only`);
  });
  return out;
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

/** A waiver row as inPage.ts READ_WAIVERS reads it (Checkpoint 7e; planner reply to Checkpoint 7d, items 3.1–3.4; no names). */
export interface WaiverMoveRead {
  /** It starts "Add" with the player's name (item 3.1: "Add A, drop B"). */
  add: boolean;
  /** How it makes room: "Drop" the player named, "Open roster spot", why he can't join (blocked), or none of these. */
  kind: "drop" | "open" | "blocked" | "none";
  /** Its main number's label ("Helps you", "Lineup gain") and value ("27", "No gain", "+2.5 pts", "No room", "Can't add"). */
  main: string;
  mainValue: string;
  /** Its second number reads as one ("Outscores … by 18", "… outscores him by 3", "Even with …", "No drop needed: …"). */
  outscores: boolean;
  /**
   * Its lock buttons, and whether each is named "Untouchable: …" (one name whichever way it's set, aria-pressed saying which:
   * review of wave C, UI-C-10) with what pressing it does as its title ("Lock … as untouchable", "… is untouchable. Unlock
   * him"). Since that review a row that can't be made has none (its untouchables' locks are on the line above the lists).
   */
  locks: number;
  lockNames: boolean;
}

/**
 * Problems with a waiver list's rows (pure; Checkpoint 7e, planner reply to Checkpoint 7d, items 3.1–3.4): each reads as one
 * move ("Add" him, then "Drop" the player named, an open roster spot, or why he can't join); a move that can be made has its
 * main number labeled for its list (`expect.main`: "Helps you" on a rated "Rest of season", a whole number or "No gain";
 * "Lineup gain" on a one-week list or a season list not rated) and its second number in words; a move that can't be made its
 * number under the same label (review of wave C, UI-C-4: "Lineup gain" broke a rated list's column) and no lock (UI-C-7);
 * and, where the page lets the user edit (`expect.locks`), a lock next to each drop. Every lock is named for its player and
 * says on hover what pressing it does.
 */
export function waiverMoveProblems(moves: readonly WaiverMoveRead[], expect: { main: "Helps you" | "Lineup gain"; locks: boolean }): string[] {
  const problems: string[] = [];
  moves.forEach((m, i) => {
    const row = `row ${i + 1}`;
    if (!m.add) problems.push(`${row} doesn't start “Add” with the player's name`);
    if (m.kind === "none") problems.push(`${row} names no drop, open roster spot or reason he can't join`);
    if (m.kind !== "blocked" && m.kind !== "none") {
      if (m.main !== expect.main) problems.push(`${row}'s main number is labeled “${m.main || "(none)"}”, not “${expect.main}”`);
      else if (m.main === "Helps you" && !(m.mainValue === "No gain" || /^\d{1,3}$/.test(m.mainValue))) problems.push(`${row}'s Helps you reads “${m.mainValue}”`);
      if (!m.outscores) problems.push(`${row} doesn't say how his points compare with the drop's`);
    }
    if (m.kind === "blocked") {
      if (m.main !== expect.main) problems.push(`${row} (can't be made) is labeled “${m.main || "(none)"}”, not “${expect.main}”`);
      if (m.locks > 0) problems.push(`${row} (can't be made) repeats ${m.locks} lock${m.locks === 1 ? "" : "s"} the untouchables line has`);
    }
    if (expect.locks && m.kind === "drop" && m.locks < 1) problems.push(`${row} has no lock next to its drop`);
    if (m.locks > 0 && !m.lockNames) problems.push(`${row}'s lock doesn't say what pressing it does`);
  });
  return problems;
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
