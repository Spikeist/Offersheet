/**
 * The in-page readers of Checkpoint 7h's checks (steps7h.ts; contracts7h.ts decides what they find), kept as plain JavaScript
 * source like inPage.ts's: they run after its PAGE_HELPERS (txt, visibleText, pageText, …) and, where they return page text, a
 * cleaning prelude (inPage.ts cleanCall), so no name of the league's comes back to Node. No template literals inside.
 *
 * - WHAT_IF_HELPERS, a prelude: the Analyzer's mode switch ("What to evaluate": WhatIfPanel.tsx AnalyzerModeSwitch), the what-if
 *   panel (the element holding the "Take off" fieldset and its own status line: the trade's part has a status line too, so it's
 *   found from the form, never by `p[role=status]` alone), its fieldsets and labeled selects.
 * - READ_WHAT_IF_SWITCH, READ_WHAT_IF_CHOICES (the rows to take off and to put on, each with its position: the step picks one of
 *   each from the page's own lists), READ_WHAT_IF (the result as contracts7h.ts WhatIfRead).
 * - readWaiverRow(id) and READ_WAIVER_ODDS: a waiver row's "Details" (its button, its panel, my odds before → after) and every
 *   shown row's odds as the page holds them (the panels are always in the page, hidden until opened).
 * - readThorough(label) and READ_FINDER_SUMMARY: the Trade Finder's "Thorough search" switch and its settings line.
 * - READ_CLOSED_IDEAS: the Trade Finder's ideas as laid out (each one's box, its "Trade idea N" and heading, whether a panel of
 *   its card is open), geometry only, so it reads the page with the league's own names on it.
 */

/** Helpers for the what-if readers and taps (after PAGE_HELPERS). */
export const WHAT_IF_HELPERS = String.raw`
const whatIfSwitch = () => document.querySelector('main [role=group][aria-label="What to evaluate"]');
const whatIfModeButton = (label) => { const g = whatIfSwitch(); return g ? [...g.querySelectorAll("button")].find((b) => txt(b) === label) || null : null; };
const whatIfPanel = () => {
  const l = [...document.querySelectorAll("main legend")].find((e) => txt(e) === "Take off");
  for (let p = l ? l.parentElement : null; p && p !== document.body; p = p.parentElement) if (p.querySelector(":scope > p[role=status]")) return p;
  return null;
};
const whatIfFieldset = (legend) => { const p = whatIfPanel(); const l = p ? [...p.querySelectorAll("legend")].find((e) => txt(e) === legend) : null; return l ? l.closest("fieldset") : null; };
const whatIfSelect = (label) => { const f = whatIfFieldset("Put on"); const l = f ? [...f.querySelectorAll("label[for]")].find((e) => txt(e) === label) : null; return l ? document.getElementById(l.getAttribute("for")) : null; };
const whatIfStatus = () => { const p = whatIfPanel(); const s = p ? p.querySelector(":scope > p[role=status]") : null; return s ? txt(s) : null; };
const whatIfShown = () => { const p = whatIfPanel(); return !!p && visible(p); };
const whatIfRows = (root) => (root ? [...root.querySelectorAll("label")].filter((l) => l.querySelector("input[type=checkbox]")) : []);
const whatIfEvaluate = () => { const p = whatIfPanel(); return p ? [...p.querySelectorAll("button")].find((b) => txt(b) === "Evaluate change") || null : null; };
`;

/** The mode switch's buttons (contracts7h.ts WhatIfSwitchRead), or null without the switch. */
export const READ_WHAT_IF_SWITCH = String.raw`
const g = whatIfSwitch();
if (!g) return null;
return { buttons: [...g.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return { label: txt(b), pressed: b.getAttribute("aria-pressed"), height: Math.round(r.height * 10) / 10, width: Math.round(r.width) }; }) };
`;

/**
 * The what-if form's rows (after a cleaning prelude): "Take off" (my players) and "Put on" (the picker's matches), each with its
 * place in its list, its words as seen, its position (the first part of its detail, "QB · BUF" → "QB"), whether it's on IR
 * ("IR slot"), checked or disabled; the "From" and "Position" selects' options; the picker's line (its prompt or count).
 */
export const READ_WHAT_IF_CHOICES = String.raw`
const row = (l, i) => {
  const input = l.querySelector("input[type=checkbox]");
  const detail = l.querySelector("span.block");
  const name = l.querySelector("span.font-semibold");
  const d = detail ? txt(detail) : "";
  return { index: i, text: clean((name ? txt(name) : visibleText(l)) + (d ? " (" + d + ")" : "")), pos: d.split(" · ")[0] || null, ir: / · IR slot$/.test(d), checked: !!input && input.checked, disabled: !!input && input.disabled };
};
const take = whatIfFieldset("Take off");
const put = whatIfFieldset("Put on");
const opts = (s) => (s ? [...s.options].map((o) => ({ value: o.value, label: clean(txt(o)) })) : []);
const live = put ? put.querySelector("p[aria-live]") : null;
return {
  shown: whatIfShown(),
  take: whatIfRows(take).map(row),
  put: put ? whatIfRows(put).filter((l) => l.closest("[role=group]")).map(row) : [],
  from: opts(whatIfSelect("From")),
  positions: opts(whatIfSelect("Position")),
  prompt: live ? clean(txt(live)) : null,
};
`;

/** The what-if's "Take off" (`side` "take") or picker (`side` "put") row `i`, for a tap (an expression). */
export function whatIfRow(side: "take" | "put", i: number): string {
  const list = side === "take" ? `whatIfRows(whatIfFieldset("Take off"))` : `whatIfRows(whatIfFieldset("Put on")).filter((l) => l.closest("[role=group]"))`;
  return `(${list})[${String(i)}] || null`;
}

/**
 * The what-if's result (contracts7h.ts WhatIfRead; after a cleaning prelude): the panel shown, its status line (a change that
 * can't be made is said there: whatIfView.ts whatIfStatus), the result section, its paragraphs outside the card, the card (its
 * heading, Helps you as seen, its paragraphs, its odds lines: label and value as seen, its weekly line, the players under "You
 * take off" and "You put on"), every <dt> and button in the section, its words with hover texts, and the address's change.
 */
export const READ_WHAT_IF = String.raw`
const p = whatIfPanel();
const status = whatIfStatus();
const sec = p ? p.querySelector('section[aria-labelledby="whatif-title"]') : null;
const art = sec ? sec.querySelector("article") : null;
const seen = (e) => clean(visibleText(e));
const q = new URLSearchParams(location.search);
const address = { mode: q.get("mode"), remove: q.getAll("remove"), add: q.getAll("add"), others: [...new Set([...q.keys()])].filter((k) => k !== "mode" && k !== "remove" && k !== "add") };
const illegal = status && status.startsWith("This change can't be made: ") ? clean(status.slice("This change can't be made: ".length)) : null;
const listed = (title) => {
  const h = art ? [...art.querySelectorAll("h4")].find((e) => txt(e) === title) : null;
  const ul = h && h.nextElementSibling && h.nextElementSibling.tagName === "UL" ? h.nextElementSibling : null;
  return ul ? ul.querySelectorAll(":scope > li").length : 0;
};
let card = null;
if (art) {
  const helpsDt = [...art.querySelectorAll("dt")].find((d) => txt(d) === "Helps you");
  const helpsDd = helpsDt ? helpsDt.parentElement.querySelector("dd") : null;
  const ps = [...art.querySelectorAll("p")];
  const odds = [];
  let weekly = null;
  for (const x of ps) {
    const items = [...x.querySelectorAll(":scope > span.whitespace-nowrap")].map((s) => { const l = s.querySelector("span.font-semibold"); const label = l ? txt(l) : ""; return { label: label, value: visibleText(s).slice(label.length).trim() }; });
    if (items.length && items.every((i) => / odds$/.test(i.label))) odds.push(...items);
    const first = x.firstElementChild;
    if (first && first.matches("span.font-semibold") && /:$/.test(txt(first)) && !weekly) weekly = { label: txt(first).replace(/:$/, ""), items: [...x.querySelectorAll("span.whitespace-nowrap")].map(txt) };
  }
  card = { heading: art.querySelector("h3") ? txt(art.querySelector("h3")) : null, helps: helpsDd ? visibleText(helpsDd) : null, lines: ps.map(seen).filter(Boolean), odds: odds, weekly: weekly, removed: listed("You take off"), added: listed("You put on") };
}
return {
  panel: whatIfShown(),
  status: status === null ? null : clean(status),
  section: !!sec,
  heading: sec && sec.querySelector("h2") ? txt(sec.querySelector("h2")) : null,
  illegal: illegal,
  lines: sec ? [...sec.querySelectorAll("p")].filter((x) => !art || !art.contains(x)).map(seen).filter(Boolean) : [],
  card: card,
  labels: sec ? [...sec.querySelectorAll("dt")].map(txt) : [],
  buttons: sec ? [...sec.querySelectorAll("button")].map(visibleText) : [],
  text: sec ? clean(pageText(sec, { all: true, attributes: true })) : "",
  address: address,
};
`;

/** The what-if card's roster-move lines (cleaned), for the release contract. */
export const READ_WHAT_IF_MOVES = String.raw`
const p = whatIfPanel();
return p ? [...p.querySelectorAll('[data-roster-moves="whatif"] > li')].map((li) => clean(txt(li))) : [];
`;

// ---------------------------------------------------------------------------------------------
// Waiver upgrades: a row's "Details" and its odds lines (WaiverUpgrades.tsx WaiverRowCard)

/** The odds lines of a row's panel: its "Your odds" frame and each line after it, as seen (in-page helper). */
const PANEL_ODDS = String.raw`
const panelOdds = (panel) => {
  const dts = panel ? [...panel.querySelectorAll("dt")] : [];
  const at = dts.findIndex((d) => txt(d) === "Your odds");
  if (at < 0) return { frame: null, odds: [] };
  const dd = (d) => (d.nextElementSibling && d.nextElementSibling.tagName === "DD" ? visibleText(d.nextElementSibling) : "");
  const odds = dts.slice(at + 1).filter((d) => / odds$/.test(txt(d))).map((d) => ({ label: txt(d), value: dd(d) }));
  return { frame: dd(dts[at]), odds: odds };
};
`;

/**
 * The "Details" of the shown waiver row adding player `id` (contracts7h.ts WaiverRowRead; after a cleaning prelude): its
 * button (aria-expanded, whether aria-controls names its panel, its size, whether it has keyboard focus), its panel (hidden or
 * not), the odds lines there and the panel's words with hover texts. The id is a canonical player id (never a name), compared
 * in the page.
 */
export function readWaiverRow(id: string): string {
  return (
    PANEL_ODDS +
    String.raw`
const want = ` +
    JSON.stringify(id) +
    String.raw`;
const s = document.getElementById("waivers");
const b = s ? [...s.querySelectorAll("button[data-waiver-details]")].find((x) => x.getAttribute("data-waiver-details") === want) || null : null;
const a = document.activeElement;
const active = a && a !== document.body ? a.tagName.toLowerCase() + (a.hasAttribute("data-waiver-details") ? " (a row's Details)" : "") + ' "' + clean(visibleText(a)).slice(0, 60) + '"' : "the page";
if (!b) return { found: false, expanded: null, controls: false, hidden: true, focused: false, height: 0, width: 0, frame: null, odds: [], text: "", active: active };
const id = b.getAttribute("aria-controls");
const panel = id ? document.getElementById(id) : null;
const r = b.getBoundingClientRect();
const o = panelOdds(panel);
return {
  found: true,
  expanded: b.getAttribute("aria-expanded"),
  controls: !!panel,
  hidden: !panel || panel.hidden || !rendered(panel, new Map()),
  focused: a === b,
  height: Math.round(r.height * 10) / 10,
  width: Math.round(r.width),
  frame: o.frame === null ? null : clean(o.frame),
  odds: o.odds,
  text: panel ? clean(pageText(panel, { all: true, attributes: true })) : "",
  active: active,
};
`
  );
}

/** The shown waiver row adding player `id`'s "Details" button, for a tap (an expression). */
export function waiverDetailsButton(id: string): string {
  return `[...document.querySelectorAll("#waivers button[data-waiver-details]")].find((x) => x.getAttribute("data-waiver-details") === ${JSON.stringify(id)}) || null`;
}

/**
 * Every shown waiver row's odds (contracts7h.ts WaiverRowOdds, and the row's player id for a tap; no names): whether its move
 * can't be made (its main number "Can't add" or "No room"), whether it helps (a main number above 0), and the odds lines its
 * panel holds, hidden or not. The rows above the fold and, while it's open, the folded ones.
 */
export const READ_WAIVER_ODDS =
  PANEL_ODDS +
  String.raw`
const s = document.getElementById("waivers");
const lists = s ? [...s.querySelectorAll('ul[data-waiver-rows="shown"], ul[data-waiver-rows="rest"]')] : [];
return lists.flatMap((ul) => [...ul.querySelectorAll(":scope > li")].map((li) => {
  const b = li.querySelector("button[data-waiver-details]");
  const panel = b && b.getAttribute("aria-controls") ? document.getElementById(b.getAttribute("aria-controls")) : null;
  const main = [...li.querySelectorAll("p")].map(txt).find((t) => /^(Helps you|Lineup gain):/.test(t)) || "";
  const value = main.replace(/^[^:]*:\s*/, "");
  const o = panelOdds(panel);
  return { id: b ? b.getAttribute("data-waiver-details") : null, list: ul.getAttribute("data-waiver-rows"), blocked: /^(Can't add|No room)$/.test(value), helps: /^\+?\d/.test(value) && !/^\+?0(\.0)?( pts)?$/.test(value), odds: o.frame !== null, labels: o.odds.map((x) => x.label) };
}));
`;

// ---------------------------------------------------------------------------------------------
// The Trade Finder's "Thorough search" (TradeFinderPage.tsx FinderControls)

/** The Thorough search switch labeled `label` (contracts7h.ts ThoroughSwitchRead): role, checked, its help, its label's box. */
export function readThorough(label: string): string {
  return (
    String.raw`
const want = ` +
    JSON.stringify(label) +
    String.raw`;
const input = [...document.querySelectorAll("main input[type=checkbox]")].find((i) => { const l = i.closest("label"); return !!l && txt(l) === want; }) || null;
if (!input) return { found: false, label: null, role: null, checked: false, help: null, height: 0, width: 0 };
const l = input.closest("label");
const r = l.getBoundingClientRect();
const help = input.getAttribute("aria-describedby") ? document.getElementById(input.getAttribute("aria-describedby")) : null;
return { found: true, label: txt(l), role: input.getAttribute("role"), checked: input.checked, help: help ? txt(help) : null, height: Math.round(r.height * 10) / 10, width: Math.round(r.width) };
`
  );
}

/** The Thorough search switch labeled `label`, for a tap: its label (an expression). */
export function thoroughSwitch(label: string): string {
  return `([...document.querySelectorAll("main input[type=checkbox]")].find((i) => { const l = i.closest("label"); return !!l && txt(l) === ${JSON.stringify(label)}; }) || { closest: () => null }).closest("label")`;
}

/** The settings line under the Trade Finder's controls ("Up to 2 players a side. …"), without its "Change in Settings" link. */
export const READ_FINDER_SUMMARY = String.raw`
const p = [...document.querySelectorAll("main p")].find((x) => [...x.querySelectorAll("a")].some((a) => txt(a) === "Change in Settings"));
return p ? txt(p).replace(/\s*Change in Settings$/, "") : null;
`;

// ---------------------------------------------------------------------------------------------
// The Trade Finder's closed ideas (TradeFinderPage.tsx Results' list; TradeCard.tsx's closed card)

/**
 * Each idea of the Trade Finder's list as laid out, in the list's order (contracts7h.ts ClosedIdeaRead): the box of its list item
 * (which holds its card and nothing else), the boxes of its "Trade idea N" and of its heading (the element its <article> is
 * labeled by), in page coordinates to a tenth of a px; whether the heading carries the "Helps both" tag (TradeCard.tsx: the two
 * one piece of the row, the tag the heading's sibling); and whether one of its card's disclosure buttons is open (Details, How
 * to offer it). Geometry and yes or no only: no text of the page comes back, so it can read the page with the league's own team
 * names on it (steps7h.ts closedIdeasChecks). Its own scope, so its names can't clash with the helpers'.
 */
export const READ_CLOSED_IDEAS = String.raw`
return (() => {
  const ideaList = document.querySelector("main ol[data-now-or-later]");
  const tenth = (v) => Math.round(v * 10) / 10;
  const boxOf = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { top: tenth(r.top + window.scrollY), bottom: tenth(r.bottom + window.scrollY), left: tenth(r.left), right: tenth(r.right) };
  };
  const ideaItems = ideaList ? [...ideaList.children].filter((li) => li.matches("li[data-trade-key]")) : [];
  return ideaItems.map((li) => {
    const a = li.querySelector("article");
    const labelledBy = a ? a.getAttribute("aria-labelledby") : null;
    const heading = labelledBy ? document.getElementById(labelledBy) : null;
    const eyebrow = a ? [...a.querySelectorAll("p")].find((p) => /^Trade idea \d+$/.test((p.textContent || "").trim())) || null : null;
    const pair = heading ? heading.parentElement : null;
    return {
      item: boxOf(li),
      eyebrow: boxOf(eyebrow),
      heading: boxOf(heading),
      tagged: !!pair && [...pair.children].some((c) => c !== heading && (c.textContent || "").trim() === "Helps both"),
      open: !!a && [...a.querySelectorAll("button[aria-controls]")].some((b) => b.getAttribute("aria-expanded") === "true"),
    };
  });
})();
`;
