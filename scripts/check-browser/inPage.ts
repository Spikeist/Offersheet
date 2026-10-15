/**
 * Code that runs inside the page for `npm run check:browser`, kept as plain JavaScript source (strings), so what the
 * browser runs never depends on how this TypeScript is transpiled. Written for current Chrome. No template literals
 * inside (these strings are template literals themselves), so the in-page code concatenates with +.
 *
 * - INSTRUMENT, added to every new document: a log of what the status lines and the progress bar say, and when
 *   (MutationObserver), the main thread's long tasks, and each answer of the engine's Web Worker (the Worker
 *   constructor is wrapped to listen to its messages): a search's own per-stage timings and counts, which the
 *   Trade Finder shows only as one total. Part B: every Content-Security-Policy violation the document sees (enforced
 *   or report-only: the securitypolicyviolation event) becomes a console error starting with CSP_MARK, which page.ts
 *   counts as a CSP violation, so one can't pass unnoticed whatever level the browser logs it at.
 * - PAGE_HELPERS, in scope for every check: text, waits, React-friendly select and input setters, and measure(): page
 *   overflow at 375 px, elements past the right edge outside a horizontal scroll or clip container, and tap targets
 *   under 44 px tall or 24 px wide. A link is exempt only inside a sentence (WCAG 2.5.8's inline exception): an inline
 *   link with other words on its line ("Values: FantasyCalc" after a sentence); a link alone in a list item or a cell
 *   is measured. A checkbox or radio is measured by its label. "Harder to get" tags (tagLeaves), the "You" badge that
 *   marks my team, and noImport(): the page's "No league imported yet" (or "Offer Sheet was updated") card, so a wait
 *   fails at once. Texts come back whole: Node cuts them only after cleaning them (report.ts cutText), so a name is
 *   never cut in two where its rule can't find it. Phase 4c: the league store's rows (storeRows: IndexedDB
 *   "offersheet", read only, never creating the database), the tab's league (tabLeague), a saved league's import,
 *   settings and feedback, and whether a heading shows a league's own name (showsName: compared in the page, so the
 *   name itself never comes back to Node).
 * - CARD_HELPERS: a trade card as data (its give and get lists with their tags, the three numbers, the chance it goes
 *   through when the league's review cuts it, links, buttons; since Checkpoint 7c its "Helps both" tag and the partner's
 *   line: Helps them as printed and the labels of their odds; since Checkpoint 7d the card's own line read outside its "If
 *   they say no, try:" box, and whether the box shows one).
 * - sanitizeCall(rules): replaces team, owner and league names and the league id in the page's text and attributes
 *   with placeholders before a screenshot, by report.ts's rules (NAME_REPLACER is report.ts replaceNames, for the page;
 *   a test runs both on the same texts), and keeps what it changed: RESTORE_CALL puts it back right after the capture,
 *   so later checks read the real page (measurements are taken before, on the real text).
 * - Phase 7b (Checkpoint 7b's checks; contracts.ts decides what they find): PAGE_HELPERS' pageText (the words a user
 *   can see or hear, or, with `all`, every word a tap could show) and rendered(); cleanCall(rules), a prelude that defines
 *   clean(text) with the same rules, so every text a reader returns has the league's names replaced already (a team
 *   named like a code or a number is never taken for one, and no name comes back to Node); and the readers (READ_*):
 *   the Import Report's notices, the League page's player tables and breakdowns (each opened for the reading and closed
 *   again), its "Things to know" banner, the Trade Finder's warnings, timing lines and cards, the links to FantasyCalc, the
 *   header's links, the waiver view, and the Settings page's goal, playoff weight (a MutationObserver installed before
 *   the page opens: WATCH_PLAYOFF_WEIGHT) and "Protect my trade value".
 * - Checkpoint 7c (planner reply to Checkpoint 7b, §6, league prizes): the Settings page's "Your league's prizes"
 *   (READ_SETTINGS_PRIZES), typing into one of its fields as a user would, saving it with Enter or leaving it
 *   (typePrize: React's own input, keydown and focusout events), the saved league's settings and the schedule's weeks the
 *   split is counted over (READ_PRIZE_LEAGUE: no names), each card's odds lines' labels (READ_CARD_ODDS) and my odds'
 *   lines on the League page (READ_MY_ODDS).
 */
import { VALUES_CREDIT } from "./contracts";

/** How the instrumentation's CSP reports start (page.ts consoleCallKind counts them as CSP violations). */
export const CSP_MARK = "[check:csp]";

export const INSTRUMENT = String.raw`(() => {
  if (window.__check) return;
  const C = (window.__check = { events: [], longtasks: [], engine: [] });
  document.addEventListener(
    "securitypolicyviolation",
    (e) => {
      const where = e.sourceFile ? " at " + e.sourceFile + ":" + e.lineNumber : "";
      console.error("${CSP_MARK} " + (e.disposition === "report" ? "report-only " : "") + e.effectiveDirective + " blocked " + (e.blockedURI || "inline") + where);
    },
    true,
  );
  const txt = (e) => ((e && e.textContent) || "").replace(/\s+/g, " ").trim();
  const snap = () => {
    const status = [...document.querySelectorAll("p[role=status]")].map(txt).filter(Boolean).join(" | ");
    const pb = document.querySelector("[role=progressbar]");
    return { path: location.pathname + location.search, status: status, pb: pb ? pb.getAttribute("aria-valuetext") || "" : null };
  };
  let last = "";
  let queued = false;
  const check = () => {
    queued = false;
    const s = snap();
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    C.events.push(Object.assign({ t: performance.now() }, s));
    if (C.events.length > 5000) C.events.splice(0, 1000);
  };
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      queueMicrotask(check);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-valuenow", "aria-valuetext"] });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) C.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  const Base = window.Worker;
  if (typeof Base === "function") {
    window.Worker = class extends Base {
      constructor(url, options) {
        super(url, options);
        this.addEventListener("message", (event) => {
          const d = event.data;
          if (!d || typeof d !== "object") return;
          if (d.type === "trades" && d.result) {
            C.engine.push({ t: performance.now(), type: "trades", timings: d.result.timings || null, counts: d.result.counts || null, shown: Array.isArray(d.result.trades) ? d.result.trades.length : null });
          } else if (d.type === "analysis" || d.type === "league" || d.type === "error" || d.type === "cancelled") {
            C.engine.push({ t: performance.now(), type: d.type });
          }
        });
      }
    };
  }
})();`;

export const PAGE_HELPERS = String.raw`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (e) => ((e && e.textContent) || "").replace(/\s+/g, " ").trim();
const statusLines = () => [...document.querySelectorAll("p[role=status]")].map(txt).filter(Boolean);
const alerts = () => [...document.querySelectorAll("[role=alert]")].map(txt).filter(Boolean);
const navLink = (href) => [...document.querySelectorAll("nav[aria-label=Main] a")].find((a) => a.getAttribute("href") === href) || null;
const byText = (selector, text, root) => [...(root || document).querySelectorAll(selector)].find((e) => txt(e) === text) || null;
const byPrefix = (selector, text, root) => [...(root || document).querySelectorAll(selector)].find((e) => txt(e).startsWith(text)) || null;
function setSelect(el, value) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function setInput(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function box(e) {
  const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
}
function visible(e) {
  if (e.closest(".sr-only")) return false;
  const r = e.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(e);
  return cs.visibility !== "hidden" && cs.display !== "none";
}
function clipAncestor(e) {
  for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return p;
  }
  return null;
}
function visibleText(e) {
  const c = e.cloneNode(true);
  for (const s of c.querySelectorAll(".sr-only")) s.remove();
  return txt(c);
}
// Whole: Node cleans names out of it, then cuts it (the file header).
function desc(e) {
  return e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + ' "' + visibleText(e) + '"';
}
// The words on a block's lines: its text and its inline elements' text, not its block children's (nor skip's).
function lineText(block, skip) {
  let s = "";
  for (const n of block.childNodes) {
    if (n === skip) continue;
    if (n.nodeType === 3) {
      s += n.nodeValue;
      continue;
    }
    if (n.nodeType !== 1 || (n.classList && n.classList.contains("sr-only"))) continue;
    const d = getComputedStyle(n).display;
    if (d === "none" || !d.startsWith("inline")) continue;
    s += lineText(n, skip);
  }
  return s;
}
// A link inside a sentence (WCAG 2.5.8's inline exception): other words on its lines, in the block it sits in.
function inSentence(link) {
  let block = link.parentElement;
  while (block && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
  return !!block && /[\p{L}\p{N}]/u.test(lineText(block, link));
}
const TAP_SELECTOR = "button, a[href], input, select, summary, textarea";
function measure(root) {
  const scope = root || document;
  const de = document.documentElement;
  const cw = de.clientWidth;
  const loose = [];
  for (const e of scope.querySelectorAll("body *")) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right <= cw + 0.5 && r.left >= -0.5) continue;
    if (clipAncestor(e)) continue;
    loose.push(desc(e) + " from " + Math.round(r.left) + " to " + Math.round(r.right) + " px");
  }
  const small = [];
  let targets = 0;
  for (const e of scope.querySelectorAll(TAP_SELECTOR)) {
    if (e.tagName === "INPUT" && e.type === "hidden") continue;
    if (e.tagName === "A" && !/min-h-11/.test(e.className) && getComputedStyle(e).display === "inline" && inSentence(e)) continue;
    const target = (e.type === "checkbox" || e.type === "radio") && e.closest("label") ? e.closest("label") : e;
    if (!visible(target)) continue;
    targets++;
    const r = target.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 24) small.push(desc(target) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  return { pageOverflow: de.scrollWidth > cw, scrollWidth: de.scrollWidth, clientWidth: cw, loose: loose.slice(0, 12), looseCount: loose.length, small: small.slice(0, 12), smallCount: small.length, targets: targets };
}
const TAG_TEXT = "Harder to get";
function tagLeaves(root) {
  return [...(root || document).querySelectorAll("span")].filter((e) => e.children.length === 0 && e.textContent.trim() === TAG_TEXT && !e.closest(".sr-only"));
}
function noImport() {
  const t = txt(document.querySelector("main h1") || document.querySelector("h1"));
  return t === "No league imported yet" || t === "Offer Sheet was updated" ? t : null;
}
function hasYouBadge(root) {
  return [...root.querySelectorAll("span")].some((e) => e.children.length === 0 && e.textContent.trim() === "You");
}
function engineSince(mark) {
  return (window.__check ? window.__check.engine : []).filter((e) => e.t >= mark);
}
function eventsSince(mark) {
  return (window.__check ? window.__check.events : []).filter((e) => e.t >= mark);
}
function longtasksSince(mark) {
  return (window.__check ? window.__check.longtasks : []).filter((l) => l.t >= mark).map((l) => l.d);
}
// The league store (src/lib/leagueStore.ts): IndexedDB "offersheet", one row per league in each store; the tab's league
// (a saved league's id, "<platform>:<8 hex>:<season>") in sessionStorage. Read only, and never by creating the database:
// opened without a version only when it's there already (an open of a missing one would create it empty).
const STORE_DB = "offersheet";
const TAB_LEAGUE_KEY = "offersheet:current-league:v1";
async function storeRows(store) {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return [];
  if (!(await indexedDB.databases()).some((d) => d.name === STORE_DB)) return [];
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(STORE_DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains(store)) return [];
    return await new Promise((resolve, reject) => {
      const q = db.transaction(store, "readonly").objectStore(store).getAll();
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  } finally {
    db.close();
  }
}
function tabLeague() {
  try {
    return sessionStorage.getItem(TAB_LEAGUE_KEY);
  } catch (e) {
    return null;
  }
}
// A saved league's settings and feedback key: its id without the season.
const leagueKeyOf = (id) => (id ? id.replace(/:\d{4}$/, "") : null);
// A saved league's import (the tab's league when no id is given), or null.
async function savedImport(id) {
  const want = id === undefined ? tabLeague() : id;
  const row = (await storeRows("imports")).find((r) => r.id === want);
  return row && row.stored ? row.stored : null;
}
async function savedLeagueIds() {
  return (await storeRows("leagues")).map((r) => r.id);
}
// One league's feedback records (its saved id), or every league's.
async function savedFeedback(id) {
  const key = id === undefined ? undefined : leagueKeyOf(id);
  return (await storeRows("feedback")).filter((r) => key === undefined || r.leagueKey === key).flatMap((r) => (Array.isArray(r.records) ? r.records : []));
}
// One league's saved settings (its saved id), or null (the defaults).
async function savedSettings(id) {
  const key = leagueKeyOf(id);
  const row = (await storeRows("settings")).find((r) => r.leagueKey === key);
  return row && row.settings ? row.settings : null;
}
// The names an import holds, as the cleaning needs them (report.ts LeagueNames).
function namesOf(stored) {
  const s = stored && stored.response && stored.response.snapshot;
  if (!s) return null;
  return { leagueName: s.name, teams: s.teams.map((t) => ({ id: String(t.id), name: t.name, ownerName: t.ownerName })), players: Object.values(s.players).map((p) => p.name).filter(Boolean) };
}
// Whether a heading or title shows a league's own name (whitespace collapsed as txt() collapses it).
function showsName(el, stored) {
  const s = stored && stored.response && stored.response.snapshot;
  return !!el && !!s && typeof s.name === "string" && s.name.trim().length > 0 && txt(el) === s.name.replace(/\s+/g, " ").trim();
}
const switcherButton = () => document.querySelector("[data-league-switcher] > button");
// Whether an element is rendered, its text there to see or hear (cache: a Map, one per reading): not in a script, style,
// template or noscript, not display none (the hidden attribute included), and not in a closed <details> outside its
// summary.
function rendered(el, cache) {
  if (!el) return false;
  if (cache.has(el)) return cache.get(el);
  let ok;
  if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) ok = false;
  else if (getComputedStyle(el).display === "none") ok = false;
  else {
    const p = el.parentElement;
    if (!p) ok = true;
    else if (p.tagName === "DETAILS" && !p.open && [...p.children].find((c) => c.tagName === "SUMMARY") !== el) ok = false;
    else ok = rendered(p, cache);
  }
  cache.set(el, ok);
  return ok;
}
// The text under root in document order, whole (Node cleans it, then cuts it). By default what a user can see or hear
// (screen-reader-only text included: it's read out); opts.all: every word a tap could show too (a closed <details>, a row
// not opened), never a script's or a style's; opts.stop: up to that element (its own text and what follows left out, its
// and their title and aria-label texts too); opts.attributes: the title and aria-label texts too.
function pageText(root, opts) {
  const o = opts || {};
  if (!root) return "";
  const cache = new Map();
  const parts = [];
  const beyond = (n) => !!o.stop && (o.stop.contains(n) || !!(o.stop.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (beyond(n)) break;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
    if (!o.all && (!rendered(el, cache) || getComputedStyle(el).visibility !== "visible")) continue;
    if (n.nodeValue && n.nodeValue.trim()) parts.push(n.nodeValue);
  }
  if (o.attributes) {
    for (const el of root.querySelectorAll("[title], [aria-label]")) {
      if (beyond(el)) continue;
      for (const a of ["title", "aria-label"]) {
        const v = el.getAttribute(a);
        if (v && v.trim()) parts.push(v);
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
// A link to FantasyCalc's site (www. too, so a link that strays is still checked).
const isFantasyCalc = (a) => /^https?:\/\/(?:www\.)?fantasycalc\.com(?:[\/?#]|$)/i.test((a.getAttribute("href") || "").trim());
// An element's label as it reads on screen: without its decorations (aria-hidden: a summary's "▾") or screen-reader-only words.
function labelText(el) {
  if (!el) return "";
  const c = el.cloneNode(true);
  for (const x of c.querySelectorAll('[aria-hidden="true"], .sr-only')) x.remove();
  return txt(c);
}
`;

export const CARD_HELPERS = String.raw`
function scoreOf(a, label) {
  const dt = [...a.querySelectorAll("dt")].find((d) => txt(d) === label);
  const dd = dt ? dt.nextElementSibling : null;
  const span = dd ? dd.querySelector("span") : null;
  return span ? txt(span) : null;
}
// The chance it goes through when the league's review could veto it: the note right under the three numbers ("…, about
// 25% it goes through."); null without one. The "Chance they accept" sort orders by it, not by the big number.
function acceptThrough(a) {
  const dt = [...a.querySelectorAll("dt")].find((d) => txt(d) === "Chance they accept");
  const dl = dt ? dt.closest("dl") : null;
  const note = dl ? dl.nextElementSibling : null;
  const t = note && note.tagName === "P" ? txt(note) : "";
  const m = /about (\d+(?:\.\d+)?)% it goes through/.exec(t);
  if (m) return m[1] + "%";
  return /under 5% it goes through/.test(t) ? "<5%" : null;
}
function sideLists(a, title) {
  return [...a.querySelectorAll("h4")].filter((h) => txt(h) === title).map((h) => h.parentElement).filter(Boolean);
}
function assets(a, title) {
  const lists = sideLists(a, title);
  return lists.length ? [...lists[0].querySelectorAll("li")].map((li) => ({ name: txt(li.querySelector("span")), text: visibleText(li), tagged: tagLeaves(li).length > 0 })) : [];
}
const sortedIds = (list) => list.filter(Boolean).sort().join(",");
function keyParts(key) {
  const m = /^([^|]+)\|give:([^|]*)\|get:(.*)$/.exec(key || "");
  return m ? { partner: m[1], give: sortedIds(m[2].split(",")), get: sortedIds(m[3].split(",")) } : null;
}
function hrefParts(href) {
  try {
    const q = new URL(href, location.origin).searchParams;
    return { partner: q.get("partner") || "", give: sortedIds(q.getAll("give")), get: sortedIds(q.getAll("get")) };
  } catch (e) {
    return null;
  }
}
// Whether an Analyzer link opens the card's own trade: its item's data-trade-key (partner, players given and got).
function isOwnTrade(a, link) {
  const item = a.closest("li[data-trade-key]");
  const want = item ? keyParts(item.dataset.tradeKey) : null;
  const h = link ? hrefParts(link.getAttribute("href")) : null;
  return !!want && !!h && h.partner === want.partner && h.give === want.give && h.get === want.get;
}
// The card's own "Open in Analyzer", so a link to another version shown on the card (a Plan B) is never taken for it;
// the first link when none matches (the Analyzer's card has no key).
function ownAnalyzerLink(a) {
  const links = [...a.querySelectorAll("a[href^='/analyzer']")];
  return links.find((l) => isOwnTrade(a, l)) || links[0] || null;
}
// Checkpoint 7c ("Helps both"): the card's tag, a leaf with those words outside any screen-reader-only part, and the
// partner's line, the odds line whose first item is "Helps them": its score (the item's number) and the labels of their
// odds after it; null without the line. A Plan B box has neither. Checkpoint 7d: the card's own line is read outside its
// Plan B box (planBBox), and whether the box shows one of its own (it never may) is read apart.
const HELPS_BOTH_TEXT = "Helps both";
const LINE_ITEM = ":scope > span.whitespace-nowrap > span.font-semibold";
function hasHelpsBothTag(a) {
  return [...a.querySelectorAll("span")].some((e) => e.children.length === 0 && e.textContent.trim() === HELPS_BOTH_TEXT && !e.closest(".sr-only"));
}
// The card's Plan B box (TradeCard.tsx PlanBBox: its first paragraph is its heading, the planner's "If they won't move: try …"
// since Checkpoint 7e), or null. ⚠️ Only that heading: a box under Phase 4's "If they say no, try:" reads as none, and the card
// step says so (cardPlanBHeadings).
const PLAN_B_HEADING = "If they won't move: try …";
function planBBox(a) {
  const head = [...a.querySelectorAll("p")].find((p) => txt(p) === PLAN_B_HEADING);
  return head ? head.parentElement : null;
}
// Every Plan B heading the cards show, by its words (Checkpoint 7e): each box's first paragraph, the one followed by its kind
// line ("A different set of their players", "The same players of theirs, a different package").
function cardPlanBHeadings() {
  const kinds = ["A different set of their players", "The same players of theirs, a different package"];
  return [...document.querySelectorAll("article p")].filter((p) => p.nextElementSibling && kinds.includes(txt(p.nextElementSibling))).map(txt);
}
// Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1): the card's "How to offer it" (TradeCard.tsx OffersDisclosure: a
// <details> whose summary starts with those words), or null; and, opened, what it shows (contracts.ts OffersRead): its status
// line, each offer of its numbered list (its label, Helps you and the chance as printed from the paragraph that starts with
// "Helps you", whether its own message has a Copy button; its key, the item's data-offer-key, and its "Also shown as trade
// idea N." line when it's another card shown: the lead's call, wave D), and whether it shows a failure.
const OFFER_ALSO = /^Also shown as trade idea \d+\.$/;
function offersDetails(a) {
  return [...a.querySelectorAll("details")].find((d) => txt(d.querySelector("summary")).startsWith("How to offer it")) || null;
}
// The card's own "Message to send them" (TradeCard.tsx Message, after the card's facts), or null: never an offer's inside
// "How to offer it", which comes first in the card and holds its offers' messages, closed, once the card has asked for them
// (an outcome press's version question does), nor the Plan B box's.
function ownMessage(a) {
  const offers = offersDetails(a);
  const box = planBBox(a);
  return [...a.querySelectorAll("details")].find((d) => txt(d.querySelector("summary")).startsWith("Message to send them") && !(offers && offers.contains(d)) && !(box && box.contains(d))) || null;
}
function offersData(a) {
  const d = offersDetails(a);
  if (!d) return null;
  const status = d.querySelector("p[role=status]");
  const list = d.querySelector("ol");
  const offers = list
    ? [...list.children]
        .filter((li) => li.tagName === "LI")
        .map((li) => {
          const ps = [...li.children].filter((c) => c.tagName === "P");
          const lead = ps[0] ? ps[0].querySelector("span.font-semibold") : null;
          const numbers = ps.map(txt).find((t) => t.startsWith("Helps you ")) || "";
          const helps = /Helps you (\S+)/.exec(numbers);
          const chance = /Chance they accept (\S+)/.exec(numbers);
          // Its veto note, when the league's review could cut it (the chance the ladder's rules read: contracts.ts throughOf).
          const note = ps.map(txt).find((t) => / it goes through\.$/.test(t)) || "";
          const through = /(?:about (\d{1,3})%|under 5%) it goes through/.exec(note);
          const message = [...li.querySelectorAll("details")].find((m) => txt(m.querySelector("summary")).startsWith("Message to send them"));
          return {
            label: lead ? txt(lead).replace(/:$/, "") : "",
            helps: helps ? helps[1] : null,
            chance: chance ? chance[1] : null,
            through: through ? (through[1] ? through[1] + "%" : "<5%") : null,
            copy: !!message && [...message.querySelectorAll("button")].some((b) => visibleText(b) === "Copy message"),
            key: li.getAttribute("data-offer-key"),
            also: ps.map(txt).find((t) => OFFER_ALSO.test(t)) || null,
          };
        })
    : [];
  return { status: status ? txt(status) : "", offers: offers, failed: !!d.querySelector("[role=alert]") };
}
// The Trade Finder's cards by key, each its place in the list the card is on (its item's data-trade-key, 1 = first), as the
// page gives TradeCard its places; {} for a card outside such a list (the Analyzer's).
function cardPlaces(a) {
  const item = a.closest("li[data-trade-key]");
  const list = item ? item.parentElement : null;
  const out = {};
  if (!list) return out;
  [...list.children].filter((li) => li.matches("li[data-trade-key]")).forEach((li, i) => {
    out[li.dataset.tradeKey] = i + 1;
  });
  return out;
}
function partnerLine(a, skip) {
  for (const p of a.querySelectorAll("p")) {
    if (skip && skip.contains(p)) continue;
    const labels = [...p.querySelectorAll(LINE_ITEM)];
    if (labels.length && txt(labels[0]) === "Helps them") {
      const n = labels[0].nextElementSibling;
      return { helps: n ? txt(n) : null, labels: labels.slice(1).map(txt) };
    }
  }
  return null;
}
function cardData(a) {
  const link = ownAnalyzerLink(a);
  const pitch = ownMessage(a);
  const box = planBBox(a);
  const them = partnerLine(a, box);
  return {
    heading: txt(a.querySelector("h2, h3")),
    give: assets(a, "You give"),
    get: assets(a, "You get"),
    tagsOnMySide: sideLists(a, "You give").reduce((n, list) => n + tagLeaves(list).length, 0),
    helps: scoreOf(a, "Helps you"),
    accept: scoreOf(a, "Chance they accept"),
    acceptThrough: acceptThrough(a),
    overall: scoreOf(a, "Overall"),
    helpsThem: them ? them.helps : null,
    theirOdds: them ? them.labels : null,
    helpsBothTag: hasHelpsBothTag(a),
    planBHelpsThem: box ? !!partnerLine(box, null) : false,
    analyzerHref: link ? link.getAttribute("href") : null,
    linkIsOwnTrade: isOwnTrade(a, link),
    hasPitch: !!pitch,
    feedback: [...a.querySelectorAll("div[role=group] button")].map((b) => ({ label: visibleText(b).replace("✓", "").trim(), pressed: b.getAttribute("aria-pressed") === "true" })),
  };
}
function allCards() {
  return [...document.querySelectorAll("article")].map(cardData);
}
// Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2): a card's "now or after this week" line, one of the card's own
// paragraphs (never inside its Plan B box or its offers), its words as seen (no screen-reader-only part) and its tooltip; and
// the card's fact that says the tooltip's words ("After this week's games"). contracts.ts nowOrLaterProblems reads them.
function nowOrLaterOf(a) {
  const seen = (el) => {
    const c = el.cloneNode(true);
    for (const x of c.querySelectorAll(".sr-only")) x.remove();
    return txt(c);
  };
  const p = [...a.querySelectorAll(":scope > p")].find((x) => /^Helps you \S+ now\b/.test(txt(x)));
  const dt = [...a.querySelectorAll("dt")].find((d) => txt(d) === "After this week's games");
  const dd = dt ? dt.nextElementSibling : null;
  return { helps: scoreOf(a, "Helps you"), line: p ? { text: seen(p), title: p.getAttribute("title") } : null, fact: dd ? txt(dd) : null };
}
function allNowOrLater() {
  return [...document.querySelectorAll("article")].map(nowOrLaterOf);
}
`;

/**
 * report.ts replaceNames and compileNameRules for the page (the same steps, in plain JavaScript): replaceNamesIn(text,
 * compiled) and compileNames(rules), where rules are report.ts NameRules.
 */
export const NAME_REPLACER = String.raw`
function compileNames(r) {
  return {
    rules: r.rules.map((x) => ({ re: new RegExp(x.source, "giu"), to: x.to })),
    keep: r.keep.map((x) => ({ re: new RegExp(x.source, "giu"), strict: x.strict })),
  };
}
function replaceNamesIn(text, c) {
  if (!text || !c.rules.length) return text;
  const found = [];
  c.rules.forEach((r, rank) => {
    for (const m of text.matchAll(r.re)) if (m[0]) found.push({ start: m.index, end: m.index + m[0].length, to: r.to, rank: rank });
  });
  if (!found.length) return text;
  const kept = [];
  for (const k of c.keep) for (const m of text.matchAll(k.re)) if (m[0]) kept.push({ start: m.index, end: m.index + m[0].length, strict: k.strict });
  const spans = found
    .filter((f) => !kept.some((k) => k.start <= f.start && f.end <= k.end && (!k.strict || k.end - k.start > f.end - f.start)))
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.rank - b.rank);
  let out = "";
  let at = 0;
  let i = 0;
  while (i < spans.length) {
    const first = spans[i];
    const group = [first];
    let end = first.end;
    for (i++; i < spans.length && spans[i].start < end; i++) {
      end = Math.max(end, spans[i].end);
      group.push(spans[i]);
    }
    const whole = group.filter((g) => g.start === first.start && g.end === end).sort((a, b) => a.rank - b.rank)[0];
    out += text.slice(at, first.start) + (whole ? whole.to : [...new Set(group.map((g) => g.to))].join(" / "));
    at = end;
  }
  return out + text.slice(at);
}
`;

/** The cleaning rules the page gets (report.ts NameRules: the same shape, kept apart so this file needs no import). */
export interface PageNameRules {
  rules: ReadonlyArray<{ source: string; to: string }>;
  keep: ReadonlyArray<{ source: string; strict: boolean }>;
}

/**
 * The in-page call that replaces the names in the page's text, attributes, field values and title with their
 * placeholders (report.ts rules), keeping each change so RESTORE_CALL can undo it. Script and style text is left alone
 * (never shown). Returns how many places it changed.
 */
export function sanitizeCall(rules: PageNameRules): string {
  return (
    NAME_REPLACER +
    String.raw`
const NAMES = compileNames(` +
    JSON.stringify({ rules: rules.rules, keep: rules.keep }) +
    String.raw`);
if (typeof window.__checkRestore === "function") window.__checkRestore();
const undo = [];
const fix = (v) => replaceNamesIn(v, NAMES);
const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
for (let n = w.nextNode(); n; n = w.nextNode()) {
  if (n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement.tagName)) continue;
  const v = fix(n.nodeValue);
  if (v !== n.nodeValue) {
    undo.push({ kind: "text", node: n, was: n.nodeValue, now: v });
    n.nodeValue = v;
  }
}
for (const el of document.querySelectorAll("[title], [aria-label], [placeholder], [alt], input, textarea")) {
  for (const a of ["title", "aria-label", "placeholder", "alt"]) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const f = fix(v);
    if (f !== v) {
      undo.push({ kind: "attr", node: el, name: a, was: v, now: f });
      el.setAttribute(a, f);
    }
  }
  if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.value) {
    const f = fix(el.value);
    if (f !== el.value) {
      undo.push({ kind: "value", node: el, was: el.value, now: f });
      el.value = f;
    }
  }
}
const title = fix(document.title);
if (title !== document.title) {
  undo.push({ kind: "title", was: document.title, now: title });
  document.title = title;
}
// Puts back what was changed, unless the page changed it since (React's newer text stays).
window.__checkRestore = () => {
  for (const u of undo.reverse()) {
    if (u.kind === "text") {
      if (u.node.nodeValue === u.now) u.node.nodeValue = u.was;
    } else if (u.kind === "attr") {
      if (u.node.getAttribute(u.name) === u.now) u.node.setAttribute(u.name, u.was);
    } else if (u.kind === "value") {
      if (u.node.value === u.now) u.node.value = u.was;
    } else if (document.title === u.now) {
      document.title = u.was;
    }
  }
  window.__checkRestore = null;
  return undo.length;
};
return undo.length;
`
  );
}

/** The in-page call that undoes the last sanitizeCall (0 when there is nothing to undo). */
export const RESTORE_CALL = `return typeof window.__checkRestore === "function" ? window.__checkRestore() : 0;`;

// ---------------------------------------------------------------------------------------------
// Phase 7b: Checkpoint 7b's readers (steps.ts reads, contracts.ts decides)

/**
 * The prelude that defines clean(text) in the page: the league's names and id replaced by their placeholders, by
 * report.ts's rules (NAME_REPLACER, as the screenshots replace them). Every reader below that returns page text needs it
 * in front: the texts come back cleaned, and a team named like a code or a number is never taken for one.
 */
export function cleanCall(rules: PageNameRules): string {
  return NAME_REPLACER + "\nconst __names = compileNames(" + JSON.stringify({ rules: rules.rules, keep: rules.keep }) + ");\nconst clean = (t) => replaceNamesIn(t || \"\", __names);\n";
}

/**
 * The Import Report's notices (planner reply to Checkpoint 7a, §5.1; needs cleanCall): every word above "Technical details
 * (for bug reports)" (what a user can see or hear, what a tap could show: §5.1 puts everything technical in that one
 * collapsed section, so a code in another closed part, "All scoring rules" say, or in a hover text is a leak too), that
 * section (closed? what follows it in the page?), the "Notices" tile, the "Things to know" card's items, and the scoring
 * card's quiet line and "Not counted yet" box.
 */
export const READ_IMPORT_NOTICES = String.raw`
const main = document.querySelector("main");
const details = document.getElementById("technical-details");
const tileItem = [...document.querySelectorAll("section[aria-labelledby=glance-title] li")].find((li) => { const p = li.querySelector("p"); return !!p && txt(p) === "Notices"; });
const tileParas = tileItem ? [...tileItem.querySelectorAll("p")] : [];
const card = document.getElementById("notices");
const scoring = [...document.querySelectorAll("main section")].find((s) => { const h = s.querySelector("h2"); return !!h && txt(h) === "How players score"; }) || null;
const scoringParas = scoring ? [...scoring.querySelectorAll("p")] : [];
const notCounted = scoringParas.find((p) => txt(p) === "Not counted yet");
const after = [];
if (details && main) {
  for (let n = details; n && n !== main; n = n.parentElement) {
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) if (visible(s) && txt(s)) after.push(clean(desc(s)));
  }
}
return {
  before: clean(pageText(main, { stop: details, all: true, attributes: true })),
  details: details ? { tag: details.tagName.toLowerCase(), open: details.open === true, summary: labelText(details.querySelector("summary")) } : null,
  after: after,
  tile: tileParas[1] ? txt(tileParas[1]) : null,
  card: card ? [...card.querySelectorAll("li")].map((li) => clean(txt(li))) : null,
  scoring: !!scoring,
  quiet: scoringParas.map(txt).filter((t) => /\brare rules? (?:isn't|aren't) counted\b/.test(t)).map(clean),
  notCounted: notCounted && notCounted.parentElement ? clean(txt(notCounted.parentElement)) : null,
};
`;

/**
 * Every trade card on the page (needs cleanCall): all its text (closed parts, a Plan B, its message, the Analyzer's
 * "Details", screen-reader text, and its title and aria-label texts), and its FantasyCalc credit: the words before its
 * "Values: FantasyCalc" link on that line, and the link (is it the line's last thing?). The words come back as they are
 * when they're the credit itself (contracts.ts VALUES_CREDIT: no name in them), else cleaned: the cleaning replaces a name
 * wherever it shows, inside a word too, so an owner named "Val" would turn the right sentence into a wrong one.
 */
export const READ_CARD_TEXTS =
  String.raw`
const CREDIT = ` +
  JSON.stringify(VALUES_CREDIT) +
  String.raw`;
return [...document.querySelectorAll("main article")].map((a) => {
  const link = [...a.querySelectorAll("a[href]")].find(isFantasyCalc) || null;
  const line = link ? link.parentElement : null;
  const last = line ? [...line.childNodes].filter((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim())).pop() : null;
  const lead = line ? lineText(line, link).replace(/\s+/g, " ").trim() : "";
  return {
    text: clean(pageText(a, { all: true, attributes: true })),
    credit: line ? { lead: lead === CREDIT ? lead : clean(lead), link: { href: link.getAttribute("href"), rel: link.getAttribute("rel"), referrerPolicy: link.getAttribute("referrerpolicy"), text: visibleText(link), last: last === link } } : null,
  };
});
`;

/** Every link to FantasyCalc in the page as it stands (after JavaScript): its rel and referrerpolicy, and whether a footer holds it. */
export const READ_FANTASYCALC_LINKS = String.raw`
return [...document.querySelectorAll("a[href]")].filter(isFantasyCalc).map((a) => ({ href: (a.getAttribute("href") || "").trim(), rel: a.getAttribute("rel"), referrerPolicy: a.getAttribute("referrerpolicy"), inFooter: !!a.closest("footer"), hiddenBy: null }));
`;

/**
 * The League page's player tables (the rosters' and the best free agents', by their captions) and every player's
 * breakdown (needs cleanCall): their column headings, cells reading "~" and a number (the old estimate marker), the ROS
 * cells' hover texts, then each breakdown, opened for the reading (a click on its button) and closed again, and the whole
 * page's words while they're open (a breakdown is built only while it's open: PlayerTable.tsx); and the header's values
 * line (it says "unavailable right now" without FantasyCalc's values).
 */
export const READ_LEAGUE_VALUES = String.raw`
const captionOf = (t) => txt(t.querySelector("caption"));
const isRoster = (t) => /: players with rest-of-season points$/.test(captionOf(t));
const tables = [...document.querySelectorAll("main table")].filter((t) => isRoster(t) || /^Best free agents at /.test(captionOf(t)));
const headers = [...new Set(tables.flatMap((t) => [...t.querySelectorAll("thead th")].map(txt)))];
const tilde = tables.flatMap((t) => [...t.querySelectorAll("tbody td")].map(txt).filter((v) => /~\s*\d/.test(v)));
const titles = tables.flatMap((t) => [...t.querySelectorAll("tbody td[title]")].map((td) => td.getAttribute("title") || ""));
const buttons = tables.flatMap((t) => [...t.querySelectorAll("tbody th[scope=row] button[aria-expanded][aria-controls]")]);
const closed = buttons.filter((b) => b.getAttribute("aria-expanded") === "false");
for (const b of closed) b.click();
await sleep(500);
const opened = closed.filter((b) => b.getAttribute("aria-expanded") === "true");
const breakdowns = opened.map((b) => document.getElementById(b.getAttribute("aria-controls"))).filter(Boolean).map((row) => clean(pageText(row, { all: true })));
const page = clean(pageText(document.querySelector("main"), { all: true, attributes: true }));
for (const b of opened) b.click();
await sleep(300);
const valuesLine = [...document.querySelectorAll("main header p")].find((p) => [...p.querySelectorAll("a[href]")].some(isFantasyCalc)) || null;
return {
  tables: tables.length,
  roster: tables.filter(isRoster).length,
  headers: headers,
  tilde: tilde.map(clean),
  titles: titles.map(clean),
  rows: buttons.length,
  closed: closed.length,
  opened: opened.length,
  breakdowns: breakdowns,
  page: page,
  leftOpen: opened.filter((b) => b.getAttribute("aria-expanded") === "true").length,
  valuesLine: valuesLine ? clean(txt(valuesLine)) : null,
};
`;

/**
 * The League page's "Things to know" banner (the notices: planner reply to Checkpoint 7a, §5.1) and every word on the
 * page a tap could show, with its title and aria-label texts (needs cleanCall).
 */
export const READ_NOTICE_BANNERS = String.raw`
const main = document.querySelector("main");
const banners = [...main.querySelectorAll("p")].filter((p) => txt(p) === "Things to know").map((p) => p.parentElement).filter(Boolean);
return {
  banners: banners.map((b) => ({ items: [...b.querySelectorAll("li")].map((li) => clean(txt(li))), text: clean(pageText(b, { all: true })) })),
  page: clean(pageText(main, { all: true, attributes: true })),
};
`;

/**
 * The Trade Finder's warning boxes (the warn-toned boxes in its results, outside the cards: each titled "Things to know")
 * and every word on the page a tap could show, with its title and aria-label texts (needs cleanCall).
 */
export const READ_FINDER_NOTICES = String.raw`
const main = document.querySelector("main");
const results = document.querySelector("section[aria-labelledby=results-title]");
const boxes = results ? [...results.querySelectorAll("div")].filter((d) => d.classList.contains("bg-warn-bg") && !d.closest("article")) : [];
return {
  results: !!results,
  boxes: boxes.map((b) => { const first = b.firstElementChild; return { title: first && first.tagName === "P" ? txt(first) : null, text: clean(pageText(b, { all: true })) }; }),
  page: clean(pageText(main, { all: true, attributes: true })),
};
`;

/**
 * The Trade Finder's header (planner reply to Checkpoint 7a, 5.3): where its intro, "Best time to look:" and freshness
 * lines are among its paragraphs, and the two lines' words (no names: the intro, which names my team, isn't returned).
 */
export const READ_FINDER_TIMING = String.raw`
const header = document.querySelector("main header");
const paras = header ? [...header.querySelectorAll("p")] : [];
const at = (test) => paras.findIndex((p) => test(txt(p)));
const intro = at((t) => /^Trades (?:for|ranked)\b/.test(t));
const best = at((t) => t.startsWith("Best time to look:"));
const fresh = at((t) => /^(?:Trade values|Projections) updated\b/.test(t));
return { header: !!header, intro: intro, best: best >= 0 ? txt(paras[best]) : null, bestAt: best, fresh: fresh >= 0 ? txt(paras[fresh]) : null, freshAt: fresh };
`;

/**
 * What the Trade Finder's timing lines and the cards' credit depend on, from the tab's saved league (no name, no id): its
 * weeks, trade deadline, review period, current and league week, and from its saved model inputs the last week, the
 * NFL's kickoff times, whether trade values loaded, and the times the freshness line reads (FantasyCalc's list, and the
 * sources' stamps: tradeView.ts freshnessText). Null when the tab has no saved import.
 */
export const READ_TRADING_LEAGUE = String.raw`
const saved = await savedImport();
const snap = saved && saved.response && saved.response.snapshot;
if (!snap) return null;
const row = (await storeRows("models")).find((r) => r.id === tabLeague());
const stored = row && row.model;
const inputs = stored && stored.model ? stored.model : null;
return {
  settings: {
    regularSeasonWeeks: snap.settings.regularSeasonWeeks || [],
    playoffWeeks: snap.settings.playoffWeeks || [],
    tradeDeadline: snap.settings.tradeDeadline === undefined ? null : snap.settings.tradeDeadline,
    tradeReviewHours: typeof snap.settings.tradeReviewHours === "number" ? snap.settings.tradeReviewHours : null,
  },
  currentWeek: snap.currentWeek,
  leagueWeek: typeof snap.leagueWeek === "number" ? snap.leagueWeek : null,
  lastWeek: inputs && typeof inputs.lastWeek === "number" ? inputs.lastWeek : null,
  kickoffs: inputs && inputs.nfl && inputs.nfl.kickoffs ? inputs.nfl.kickoffs : null,
  inputs: !!inputs,
  hasMarket: !!(inputs && inputs.market),
  marketFetchedAt: inputs && inputs.market && typeof inputs.market.fetchedAt === "string" ? inputs.market.fetchedAt : null,
  sources: inputs && Array.isArray(inputs.sources) ? inputs.sources.filter((s) => s && typeof s.source === "string" && typeof s.fetchedAt === "string").map((s) => ({ source: s.source, fetchedAt: s.fetchedAt })) : [],
};
`;

/** The header's links as shown (planner reply to Checkpoint 7a, §6.2: six, in two rows at 375 px), each with its box. */
export const READ_NAV_LINKS = String.raw`
return {
  width: innerWidth,
  links: [...document.querySelectorAll("nav[aria-label=Main] a")].filter(visible).map((a) => Object.assign({ href: a.getAttribute("href"), text: pageText(a) }, box(a))),
};
`;

/**
 * The League page's "Waiver upgrades" (planner reply to Checkpoint 7a, §6.2), no names: whether it's there (and, when it
 * isn't, whether the page says the season is over: LeagueView.tsx's "The season is over", which leaves the section
 * nothing to list), its heading, whether that heading has keyboard focus and is on screen, the address and the history's
 * length; its toggle's buttons (label, pressed, size), its "Show all N" button, and how many rows its list shows.
 * Checkpoint 7e (planner reply to Checkpoint 7d, items 3.1–3.4): the season list's rating line (its status), the "Drop from the
 * same position" switch (its label, whether it's on, its help), and each row shown as a move (contracts.ts WaiverMoveRead:
 * whether it starts "Add", how it makes room, its main number's label and value, whether its second number reads as one, its
 * lock buttons and whether each is named "Untouchable: …" with what pressing it does as its title: review of wave C,
 * UI-C-10), never a name. Checkpoint 7f (planner reply to Checkpoint 7e, item 3): the rows that help as moves (`moves`,
 * `rows`: the list above the fold, data-waiver-rows "helping"), the folded rows (`restMoves`, `restRows`, `restId`: there
 * only while the fold is open), the fold's button (its words, aria-expanded, aria-controls, size, and whether it has keyboard
 * focus), the line when no row helps, the list's label (the toggle's button pressed) and whether it's rated (data-rated).
 */
export const READ_WAIVERS = String.raw`
const s = document.getElementById("waivers");
const a = document.activeElement;
const active = a && a !== document.body ? a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") : "the page";
if (!s) return { section: false, over: [...document.querySelectorAll("main p")].some((p) => txt(p) === "The season is over"), path: location.pathname, hash: location.hash, history: history.length, active: active };
const h = s.querySelector("h2");
const hb = h ? h.getBoundingClientRect() : null;
const group = s.querySelector('[role=group][aria-label="Which weeks"]');
const pressed = group ? [...group.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") === "true") || null : null;
const more = [...s.querySelectorAll("button[aria-expanded]")].find((b) => /^Show (?:all \d+|fewer)$/.test(txt(b))) || null;
const wrap = s.querySelector("[data-waiver-list]");
const list = s.querySelector('ul[data-waiver-rows="helping"]');
const restList = s.querySelector('ul[data-waiver-rows="rest"]');
const fold = s.querySelector("button[data-waiver-more]");
const noneEl = s.querySelector("p[data-waiver-none]");
const size = (el) => { const r = el.getBoundingClientRect(); return { height: Math.round(r.height * 10) / 10, width: Math.round(r.width) }; };
const statusEl = s.querySelector("p[role=status]");
const sw = s.querySelector("input[role=switch]");
const swLabel = sw ? sw.closest("label") : null;
const helpId = sw ? sw.getAttribute("aria-describedby") : null;
const help = helpId ? document.getElementById(helpId) : null;
const movesOf = (ul) => ul ? [...ul.querySelectorAll(":scope > li")].map((li) => {
  const ps = [...li.querySelectorAll("p")].map((p) => txt(p));
  const main = ps.find((t) => /^(Helps you|Lineup gain):/.test(t)) || "";
  const kind = ps.some((t) => /^Drop \S/.test(t)) ? "drop" : ps.includes("Open roster spot") ? "open" : ps.some((t) => /untouchable[.:]|make room for him/.test(t)) ? "blocked" : "none";
  const locks = [...li.querySelectorAll("button[aria-pressed]")].map((b) => ({ name: b.getAttribute("aria-label") || "", title: b.getAttribute("title") || "" }));
  return {
    add: /^Add \S/.test(ps[0] || ""),
    kind: kind,
    main: main.replace(/:[\s\S]*$/, ""),
    mainValue: main.replace(/^[^:]*:\s*/, ""),
    outscores: ps.some((t) => /^(Outscores .+ by [\d,.]+|.+ outscores him by [\d,.]+|Even with .+|No drop needed: [\d,.]+ .+)( (this|next) week)?$/.test(t)),
    locks: locks.length,
    lockNames: locks.every((l) => /^Untouchable: .+$/.test(l.name) && (/^Lock .+ as untouchable$/.test(l.title) || /^.+ is untouchable\. Unlock him$/.test(l.title))),
  };
}) : [];
return {
  status: statusEl ? txt(statusEl) : null,
  switch: sw ? { label: swLabel ? txt(swLabel) : null, on: sw.checked, help: help ? txt(help) : null } : null,
  moves: movesOf(list),
  restMoves: movesOf(restList),
  restRows: restList ? restList.querySelectorAll(":scope > li").length : 0,
  restId: restList ? restList.id || null : null,
  rest: fold ? Object.assign({ text: txt(fold), expanded: fold.getAttribute("aria-expanded"), controls: fold.getAttribute("aria-controls"), focused: a === fold }, size(fold)) : null,
  none: noneEl ? txt(noneEl) : null,
  label: pressed ? txt(pressed) : wrap && wrap.getAttribute("data-waiver-list") === "ros" ? "Rest of season" : null,
  rated: wrap ? wrap.getAttribute("data-rated") === "true" : null,
  section: true,
  path: location.pathname,
  hash: location.hash,
  history: history.length,
  active: active,
  heading: h ? txt(h) : null,
  focused: !!h && a === h,
  headingTop: hb ? Math.round(hb.top) : null,
  headingBottom: hb ? Math.round(hb.bottom) : null,
  viewport: innerHeight,
  inView: !!hb && hb.height > 0 && hb.top >= -1 && hb.bottom <= innerHeight + 1,
  toggle: group ? [...group.querySelectorAll("button")].map((b) => Object.assign({ label: txt(b), pressed: b.getAttribute("aria-pressed") }, size(b))) : null,
  more: more ? Object.assign({ text: txt(more), expanded: more.getAttribute("aria-expanded") }, size(more)) : null,
  rows: list ? list.querySelectorAll(":scope > li").length : 0,
  list: !!wrap,
};
`;

/** The waiver view's toggle button `i` (0: "Rest of season"), for a tap. */
export function waiverToggle(i: number): string {
  return String.raw`[...document.querySelectorAll('#waivers [role=group][aria-label="Which weeks"] button')][` + String(i) + "]";
}

/** The waiver view's "Show all N" (or "Show fewer") button, for a tap. */
export const WAIVER_SHOW_ALL = String.raw`[...document.querySelectorAll("#waivers button[aria-expanded]")].find((b) => /^Show (?:all \d+|fewer)$/.test(txt(b)))`;

/** The list's fold, "N more pickups that don't help you (show)" or "(hide)" (Checkpoint 7f), for a tap. */
export const WAIVER_REST = String.raw`document.querySelector("#waivers button[data-waiver-more]")`;

/**
 * The waiver section's every word, hover texts and labels included, the league's names replaced (after a cleaning prelude:
 * cleanCall). Checkpoint 7f: read with the fold open, so the rows that don't help (their "Why no gain" lines among them),
 * which the League step's own scan of the page no longer reaches while they're folded, are read for trade values too.
 */
export const READ_WAIVERS_TEXT = String.raw`
const s = document.getElementById("waivers");
return s ? clean(pageText(s, { all: true, attributes: true })) : "";
`;

/**
 * Before the Settings page opens (a client-side navigation keeps the document): records every value its "Playoff weeks
 * count:" line takes, with when (window.__pw), so a "Working it out…" too brief to poll is still seen (planner reply to
 * Checkpoint 7a, §6.1).
 */
export const WATCH_PLAYOFF_WEIGHT = String.raw`
window.__pw = [];
const read = () => {
  const label = [...document.querySelectorAll("main p > span")].find((s) => txt(s) === "Playoff weeks count:");
  const value = label && label.nextElementSibling ? txt(label.nextElementSibling) : null;
  const last = window.__pw[window.__pw.length - 1];
  if (value !== null && (!last || last.v !== value)) window.__pw.push({ t: performance.now(), v: value });
};
if (window.__pwWatch) window.__pwWatch.disconnect();
window.__pwWatch = new MutationObserver(read);
window.__pwWatch.observe(document, { subtree: true, childList: true, characterData: true });
read();
return true;
`;

/** The playoff weight's values so far, once it shows a weight ("×"), else null (a waitFor expression). */
export const PLAYOFF_WEIGHT_SHOWN = String.raw`(() => { const s = window.__pw || []; const last = s[s.length - 1]; return last && last.v.indexOf("×") >= 0 ? s : null; })()`;

/** Stops recording the playoff weight, and returns what it recorded. */
export const STOP_PLAYOFF_WEIGHT = String.raw`
if (window.__pwWatch) window.__pwWatch.disconnect();
window.__pwWatch = null;
return window.__pw || [];
`;

/**
 * The Settings page's scoring questions (planner reply to Checkpoint 7a, 5.2 and §2 question 5), no names: "What does your
 * league reward?" (its choices' labels, its help), "Protect my trade value"'s help, and every group's legend (for a
 * failure's details).
 */
export const READ_SETTINGS_SCORING = String.raw`
const helpOf = (fs) => { const id = fs ? fs.getAttribute("aria-describedby") : null; const el = id ? document.getElementById(id) : null; return el ? txt(el) : null; };
const goalLegend = byText("legend", "What does your league reward?");
const goal = goalLegend ? goalLegend.closest("fieldset") : null;
const protectLegend = byText("legend", "Protect my trade value");
const protect = protectLegend ? protectLegend.closest("fieldset") : null;
return {
  goal: goal ? { labels: [...goal.querySelectorAll("label")].map((l) => { const s = l.querySelector("span.font-semibold"); return s ? txt(s) : txt(l); }), help: helpOf(goal) } : null,
  protect: protect ? { help: helpOf(protect) } : null,
  legends: [...document.querySelectorAll("main legend")].map(txt),
};
`;

/**
 * The Settings page's "Your league's prizes" under "Several prizes" (Checkpoint 7c; contracts.ts PrizeGroupRead), no names:
 * its help (the fieldset's aria-describedby), each field (its label, value, height, aria-invalid, the text its
 * aria-describedby names and whether that text sits in a live region), the split line, the warning, and the goal's own
 * group's label count; `group` null when it isn't there.
 */
export const READ_SETTINGS_PRIZES = String.raw`
const goalLegend = byText("legend", "What does your league reward?");
const goal = goalLegend ? goalLegend.closest("fieldset") : null;
const goalLabels = goal ? goal.querySelectorAll("label").length : 0;
const legend = byText("legend", "Your league's prizes");
const group = legend ? legend.closest("fieldset") : null;
if (!group) return { group: null, goalLabels: goalLabels };
const helpId = group.getAttribute("aria-describedby");
const helpEl = helpId ? document.getElementById(helpId) : null;
const fields = [...group.querySelectorAll("label[for]")].map((l) => {
  const input = document.getElementById(l.getAttribute("for"));
  const errorId = input ? input.getAttribute("aria-describedby") : null;
  const error = errorId ? document.getElementById(errorId) : null;
  return {
    label: txt(l),
    value: input ? input.value : "",
    height: input ? Math.round(input.getBoundingClientRect().height * 10) / 10 : 0,
    invalid: input ? input.getAttribute("aria-invalid") : null,
    error: error ? txt(error) : null,
    live: !!(error && error.closest("[aria-live]")),
  };
});
const split = [...group.querySelectorAll("p")].map(txt).find((t) => t.startsWith("Your prizes split:")) || null;
const warning = [...group.querySelectorAll("div")].map(txt).find((t) => t.startsWith("Enter at least one prize")) || null;
return { group: { help: helpEl ? txt(helpEl) : null, fields: fields, split: split, warning: warning, goalLabels: goalLabels }, goalLabels: goalLabels };
`;

/** A "What does your league reward?" answer's label (its radio's value: "title", "prizes", "playoffs"), to tap. */
export function goalChoice(value: string): string {
  return `(() => { const r = [...document.querySelectorAll("input[type=radio][name=goal]")].find((x) => x.value === ${JSON.stringify(value)}); return r ? r.closest("label") : null; })()`;
}

/** The checked "What does your league reward?" answer's value, or null (an expression). */
export const CHECKED_GOAL = `(() => { const r = document.querySelector("input[type=radio][name=goal]:checked"); return r ? r.value : null; })()`;

/**
 * Types `text` into the prize field labeled `label` as a user would (React's own events: the value through the input
 * setter and an input event, then Enter's keydown, or the focus leaving: focusout, which React's onBlur listens to), and
 * returns whether the field was there. A body for page.run.
 */
export function typePrize(label: string, text: string, how: "enter" | "blur"): string {
  const done =
    how === "enter"
      ? `input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));`
      : `input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));`;
  return `const l = [...document.querySelectorAll("label[for]")].find((x) => txt(x) === ${JSON.stringify(label)});
const input = l ? document.getElementById(l.getAttribute("for")) : null;
if (!input) return false;
input.focus();
setInput(input, ${JSON.stringify(text)});
await sleep(80);
${done}
await sleep(80);
return true;`;
}

/**
 * The tab's saved league as the prizes' split reads it (Checkpoint 7c), no names: its saved settings (raw, as stored), and
 * its snapshot's regular-season weeks, points-only flag and each matchup's weeks (reward.ts prizePeriods), or null fields.
 */
export const READ_PRIZE_LEAGUE = String.raw`
const saved = await savedImport();
const snap = saved && saved.response && saved.response.snapshot;
const settings = await savedSettings(tabLeague());
return {
  settings: settings || null,
  snapshot: snap
    ? {
        settings: { regularSeasonWeeks: snap.settings.regularSeasonWeeks || [], pointsOnly: !!snap.settings.pointsOnly },
        schedule: (snap.schedule || []).map((m) => ({ week: m.week, weeks: Array.isArray(m.weeks) ? m.weeks : undefined, isPlayoff: !!m.isPlayoff })),
      }
    : null,
};
`;

/**
 * Each card's odds lines (Checkpoint 7c; tradeView.ts oddsViews), as lists of their labels, the card's own first and then a
 * Plan B box's: the lines whose items are "<label> <odds>" kept on one line (TradeCard.tsx OddsLines), never the weekly line,
 * nor the partner's line ("Helps them 24 · Their title odds …": cardData's theirOdds reads it).
 */
export const READ_CARD_ODDS = String.raw`
const ITEM = ":scope > span.whitespace-nowrap > span.font-semibold";
return [...document.querySelectorAll("main article")].map((a) =>
  [...a.querySelectorAll("p")]
    .map((p) => [...p.querySelectorAll(ITEM)].map(txt))
    .filter((labels) => labels.length > 0 && labels[0] !== "Helps them" && labels.every((l) => / odds$/.test(l) && !/^Their /.test(l))),
);
`;

/** My odds' lines on the League page (leagueView.ts myOddsOf): "Your odds: …" and "As rosters stand: …", as shown (screen-reader-only words left out). */
export const READ_MY_ODDS = String.raw`
return [...document.querySelectorAll("main p")].map(visibleText).filter((t) => t.startsWith("Your odds:") || t.startsWith("As rosters stand:"));
`;

/**
 * The list items of every list of roster moves (TradeCard.tsx: a card's, its Plan B box's, each offer's of "How to offer it";
 * LeagueView.tsx: my roster card's "Returns from IR"), each marked `data-roster-moves`: the lines themselves, never a card's
 * or an offer's own list item, whose text holds them all (review of Checkpoint 7f, PIERCE-1: "main li" read each Trade Finder
 * card, whose <li> holds the card, as one more "line", and the contract failed the app's right words).
 */
export const ROSTER_MOVE_LINES = "main [data-roster-moves] > li";

/**
 * Every line about a release at an IR player's return the page shows (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4):
 * "Week 7, when Alec Pierce returns from IR: …", or a card's "Assumed with or without this trade: …, release Alec Pierce in week
 * 7, when he returns from IR." (the review of Checkpoint 7f, INTEGRATION-4), from a card's roster moves, its Plan B box's and its
 * offers', or the League page's "Returns from IR" (ROSTER_MOVE_LINES, cleaned: the cleaning prelude before it).
 * contracts.ts releaseLineProblems reads them.
 */
export const READ_RELEASE_LINES = String.raw`
return [...document.querySelectorAll(${JSON.stringify(ROSTER_MOVE_LINES)})].map((li) => clean(txt(li))).filter((t) => / returns from IR\b/.test(t));
`;
