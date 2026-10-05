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
 *   through when the league's review cuts it, links, buttons).
 * - sanitizeCall(rules): replaces team, owner and league names and the league id in the page's text and attributes
 *   with placeholders before a screenshot, by report.ts's rules (NAME_REPLACER is report.ts replaceNames, for the page;
 *   a test runs both on the same texts), and keeps what it changed: RESTORE_CALL puts it back right after the capture,
 *   so later checks read the real page (measurements are taken before, on the real text).
 */

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
function cardData(a) {
  const link = ownAnalyzerLink(a);
  const pitch = [...a.querySelectorAll("details")].find((d) => txt(d.querySelector("summary")).startsWith("Message to send them"));
  return {
    heading: txt(a.querySelector("h2, h3")),
    give: assets(a, "You give"),
    get: assets(a, "You get"),
    tagsOnMySide: sideLists(a, "You give").reduce((n, list) => n + tagLeaves(list).length, 0),
    helps: scoreOf(a, "Helps you"),
    accept: scoreOf(a, "Chance they accept"),
    acceptThrough: acceptThrough(a),
    overall: scoreOf(a, "Overall"),
    analyzerHref: link ? link.getAttribute("href") : null,
    linkIsOwnTrade: isOwnTrade(a, link),
    hasPitch: !!pitch,
    feedback: [...a.querySelectorAll("div[role=group] button")].map((b) => ({ label: visibleText(b).replace("✓", "").trim(), pressed: b.getAttribute("aria-pressed") === "true" })),
  };
}
function allCards() {
  return [...document.querySelectorAll("article")].map(cardData);
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
