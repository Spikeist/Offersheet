/**
 * The rules behind Checkpoint 7h's checks of `npm run check:browser` (pure; tested in checkpoint7h.test.ts): what the pages
 * Checkpoint 7h added must show, and what they must never show. The steps (steps7h.ts) read the pages (inPage7h.ts); these
 * decide. Like contracts.ts, this file imports nothing (the app's own words come in as arguments), so a script that loads it
 * loads none of the app. Planner reply to Checkpoint 7g (reports/planner-reply-7g.md):
 *
 * - Section 4, "What if" in the Trade Analyzer (whatIfProblems): the result shows Helps you with "Helps you here counts your odds
 *   only.", the odds lines before → after in the cards' forms (oddsValueProblems), the weekly line when it shows
 *   (weeklyItemProblems), the planner's line ("Other teams don't change. To see a real trade, use the Analyzer with a
 *   partner."), and none of a trade offer's parts: no chance they accept, no Overall, no "How to offer it", no Plan B, no
 *   feedback buttons; the address carries the change as player ids only (`?mode=whatif&remove=…&add=…`). The mode switch's two
 *   44 px buttons (whatIfSwitchProblems).
 * - Section 5, Waiver upgrades: a "Rest of season" row's "Details" opens and closes with a tap, keyboard focus kept on it, and
 *   shows my odds before → after in the cards' forms ("Your odds: without a pickup → with this one (from N simulated
 *   seasons)", then the lines: waiverDetailsProblems); a rated list carries odds lines on every move that can be made, a
 *   one-week list (and a list in points) on none (waiverOddsCoverageProblems).
 * - Section 3, the Thorough search: its switch there, off by default, with "Takes about N seconds" (thoroughSwitchProblems,
 *   THOROUGH_HELP); while it's on, the settings line says the search's players a side (thoroughSummaryProblems); turned off, the
 *   normal search's ideas back as they were (sameIdeasProblems).
 * - Section 1, "With cards closed, the Trade Finder shows at least 2 ideas per screen": the closed ideas measured with the
 *   league's own team names, a phone screen's worth (closedIdeasOf, closedIdeasText; IDEAS_PER_SCREEN_GOAL).
 */

// ---------------------------------------------------------------------------------------------
// The odds lines' forms (src/lib/tradeView.ts oddsViews, titleOddsText, percentText, weeklyLine; waiversView.ts waiverOddsLines)

/** A title chance as the cards print it: one decimal, "<0.1%" and ">99.9%" at the edges. */
const TITLE_PERCENT = String.raw`(?:<0\.1%|>99\.9%|\d{1,3}\.\d%)`;
/** Any other chance as the cards print it: whole percents, "<1%" and ">99%" at the edges. */
const WHOLE_PERCENT = String.raw`(?:<1%|>99%|\d{1,3}%)`;
/** "8.9% → 9.2%": a title line's value before → after. */
export const TITLE_ODDS_VALUE = new RegExp(`^${TITLE_PERCENT} → ${TITLE_PERCENT}$`);
/** "61% → 62%": a top-N or playoff line's value before → after. */
export const WHOLE_ODDS_VALUE = new RegExp(`^${WHOLE_PERCENT} → ${WHOLE_PERCENT}$`);
/** "Week 9: 68% → 64%": one week of the weekly line. */
export const WEEKLY_ITEM = new RegExp(`^Week \\d{1,2}: ${WHOLE_PERCENT} → ${WHOLE_PERCENT}$`);
/** The weekly line's label (tradeView.ts weeklyLine). */
export const WEEKLY_LABEL = "Win chance by week";

/** One odds line as a page shows it: its label ("Title odds") and its value as seen ("8.9% → 9.2%"). */
export interface OddsLineRead {
  label: string;
  value: string;
}

/**
 * The values of odds lines that aren't before → after in the cards' forms (pure): a title line's one decimal, the others' whole
 * percents ("unknown" allowed when the app couldn't know a side: tradeView.ts oddsView, waiversView.ts oddsLine). A line that
 * shows only a change ("+4.1 percentage points", a card without its "before") fails: these lines always have their "before".
 */
export function oddsValueProblems(lines: readonly OddsLineRead[], where: string): string[] {
  return lines.flatMap((l) => {
    if (l.value === "unknown") return [];
    const form = /^Title odds$/.test(l.label) ? TITLE_ODDS_VALUE : WHOLE_ODDS_VALUE;
    return form.test(l.value) ? [] : [`${where}: “${l.label}” reads “${l.value}”, not before → after in the cards' form`];
  });
}

/** The weekly line's items that aren't "Week N: X% → Y%" (pure), and a label that isn't the cards'. */
export function weeklyItemProblems(weekly: { label: string; items: readonly string[] } | null, where: string): string[] {
  if (!weekly) return [];
  const out: string[] = [];
  if (weekly.label !== WEEKLY_LABEL) out.push(`${where}: the weekly line is labeled “${weekly.label}”, not “${WEEKLY_LABEL}”`);
  if (!weekly.items.length) out.push(`${where}: the weekly line names no week`);
  for (const item of weekly.items) if (!WEEKLY_ITEM.test(item)) out.push(`${where}: a week of the weekly line reads “${item}”`);
  return out;
}

/**
 * The labels of odds lines, in order (pure; contracts.ts oddsLabelProblems' rule, repeated here so this file imports nothing):
 * "Title odds", then "Top 3 odds" ("Top 2 odds") when the saved settings call for it (`places`), then "Playoff odds".
 */
export function oddsOrderProblems(labels: readonly string[], places: 2 | 3 | null, where: string): string[] {
  const want = ["Title odds", ...(places ? [`Top ${places} odds`] : []), "Playoff odds"];
  return labels.length === want.length && labels.every((l, i) => l === want[i]) ? [] : [`${where}: ${labels.map((l) => `“${l}”`).join(" · ") || "no odds line"}, not ${want.map((l) => `“${l}”`).join(" · ")}`];
}

// ---------------------------------------------------------------------------------------------
// Section 4: "What if" in the Trade Analyzer

/** The Analyzer's mode switch as the page shows it (WhatIfPanel.tsx AnalyzerModeSwitch): its buttons. */
export interface WhatIfSwitchRead {
  buttons: Array<{ label: string; pressed: string | null; height: number; width: number }>;
}

/**
 * The mode switch's problems (pure): exactly the app's two buttons (`labels`: whatIfView.ts ANALYZER_MODES), each a 44 px tap
 * target, the one `pressed` the only one with aria-pressed true.
 */
export function whatIfSwitchProblems(r: WhatIfSwitchRead | null, labels: readonly string[], pressed: string): string[] {
  if (!r) return ["the Analyzer has no “What to evaluate” switch"];
  const out: string[] = [];
  const got = r.buttons.map((b) => b.label);
  if (got.length !== labels.length || got.some((l, i) => l !== labels[i])) out.push(`its buttons read ${got.map((l) => `“${l}”`).join(", ") || "nothing"}, not ${labels.map((l) => `“${l}”`).join(", ")}`);
  for (const b of r.buttons) if (b.height < 43.5 || b.width < 24) out.push(`“${b.label}” is ${b.width} × ${b.height} px, under 44 px tall or 24 px wide`);
  const on = r.buttons.filter((b) => b.pressed === "true").map((b) => b.label);
  if (on.length !== 1 || on[0] !== pressed) out.push(`aria-pressed is true on ${on.map((l) => `“${l}”`).join(", ") || "no button"}, not “${pressed}” alone`);
  return out;
}

/** The what-if's result as the page shows it (inPage7h.ts READ_WHAT_IF), cleaned of the league's names. */
export interface WhatIfRead {
  /** The what-if panel is on the page and shown. */
  panel: boolean;
  /** Its status line ("Evaluated: Helps you 45."; "This change can't be made: …"), null without one. */
  status: string | null;
  /** The result section ("The change, evaluated") is there. */
  section: boolean;
  heading: string | null;
  /** The callout saying why the change can't be made, else null. */
  illegal: string | null;
  /** The section's own paragraphs outside the card, as seen (the odds before the change, the planner's line, …). */
  lines: string[];
  card: {
    heading: string | null;
    /** Helps you as printed ("45", "0", "—"). */
    helps: string | null;
    /** The card's paragraphs, as seen (the "counts your odds only" note among them). */
    lines: string[];
    odds: OddsLineRead[];
    weekly: { label: string; items: string[] } | null;
    /** How many players are listed under "You take off" and "You put on". */
    removed: number;
    added: number;
  } | null;
  /** Every <dt> label in the section (the trade card's "Chance they accept" and "Overall" are <dt>s). */
  labels: string[];
  /** Every button in the section, as seen (a feedback button, "How to offer it", …). */
  buttons: string[];
  /** The section's words, hover texts included (for FantasyCalc's values and a trade offer's parts). */
  text: string;
  /** The address: its mode, the ids it removes and adds, and any other key it carries. */
  address: { mode: string | null; remove: string[]; add: string[]; others: string[] };
}

/** What the what-if's result must say, in the app's own words (src/lib/whatIfView.ts), and what it was asked. */
export interface WhatIfExpect {
  /** WHAT_IF_ODDS_ONLY. */
  oddsOnly: string;
  /** WHAT_IF_OTHER_TEAMS. */
  otherTeams: string;
  /** How many players the step took off and put on. */
  removed: number;
  added: number;
  /** The top-N line the saved settings call for (contracts.ts expectedTopPlaces' answer). */
  places: 2 | 3 | null;
}

/** The section's heading and the card's (WhatIfPanel.tsx). */
export const WHAT_IF_SECTION_HEADING = "The change, evaluated";
export const WHAT_IF_CARD_HEADING = "Your roster with this change";
/** The status line once a change is evaluated (whatIfView.ts whatIfStatus): its Helps you as printed. */
export const WHAT_IF_STATUS = /^Evaluated: Helps you (\d{1,3})\.$/;

/** A trade offer's parts a what-if never shows (planner reply to Checkpoint 7g, section 4: "There's no partner and no chance they accept"; the lead's: no Overall, no offers, no Plan B, no feedback buttons). */
export const WHAT_IF_NO_LABELS = ["Chance they accept", "Overall", "Helps them"] as const;
export const WHAT_IF_NO_BUTTONS = /^(?:Sent|Accepted|Rejected|Countered|Report a problem|How to offer it|Open in Analyzer)\b/;
export const WHAT_IF_NO_TEXT = /If they won['’]t move|Message to send them|Chance they accept|Helps both/;

/**
 * What's wrong with a what-if's result (pure; the file header): it's evaluated (a change that can't be made fails, with its
 * words), headed as the app heads it, its status line and card saying the same Helps you, a number from 0 to 100 with "Helps you
 * here counts your odds only." under it; the odds lines in order and before → after; the weekly line, when it shows, week by
 * week; the planner's line about other teams; the players taken off and put on; none of a trade offer's parts; and an address
 * that carries the change as player ids only. Empty when it reads as it should.
 */
export function whatIfProblems(r: WhatIfRead, expect: WhatIfExpect): string[] {
  if (!r.panel) return ["the “What if” panel isn't shown"];
  if (r.illegal) return [`the change can't be made: “${r.illegal}”`];
  if (!r.section) return [`no result: the status line reads “${r.status ?? ""}”`];
  const out: string[] = [];
  if (r.heading !== WHAT_IF_SECTION_HEADING) out.push(`the result is headed “${r.heading ?? ""}”, not “${WHAT_IF_SECTION_HEADING}”`);
  if (!r.lines.includes(expect.otherTeams)) out.push(`the planner's line “${expect.otherTeams}” isn't there`);
  const c = r.card;
  if (!c) return [...out, "the result shows no card"];
  if (c.heading !== WHAT_IF_CARD_HEADING) out.push(`the card is headed “${c.heading ?? ""}”, not “${WHAT_IF_CARD_HEADING}”`);
  const helps = c.helps !== null && /^\d{1,3}$/.test(c.helps) ? Number(c.helps) : null;
  if (helps === null || helps > 100) out.push(`Helps you reads “${c.helps ?? ""}”, not a number from 0 to 100`);
  const status = WHAT_IF_STATUS.exec(r.status ?? "");
  if (!status) out.push(`the status line reads “${r.status ?? ""}”, not “Evaluated: Helps you N.”`);
  else if (helps !== null && Number(status[1]) !== helps) out.push(`the status line says Helps you ${status[1]}, the card ${helps}`);
  if (!c.lines.includes(expect.oddsOnly)) out.push(`“${expect.oddsOnly}” isn't on the card`);
  out.push(...oddsOrderProblems(c.odds.map((o) => o.label), expect.places, "its odds lines"));
  out.push(...oddsValueProblems(c.odds, "its odds lines"));
  out.push(...weeklyItemProblems(c.weekly, "its weekly line"));
  if (c.removed !== expect.removed) out.push(`“You take off” lists ${c.removed} player(s), not the ${expect.removed} taken off`);
  if (c.added !== expect.added) out.push(`“You put on” lists ${c.added} player(s), not the ${expect.added} put on`);
  for (const l of WHAT_IF_NO_LABELS) if (r.labels.includes(l)) out.push(`it shows “${l}”, which a what-if has none of`);
  for (const b of r.buttons) if (WHAT_IF_NO_BUTTONS.test(b)) out.push(`it has a “${b}” button, a trade offer's`);
  const offer = WHAT_IF_NO_TEXT.exec(r.text);
  if (offer) out.push(`it says “${offer[0]}”, a trade offer's words`);
  const a = r.address;
  if (a.mode !== "whatif") out.push(`the address's mode is “${a.mode ?? "(none)"}”, not “whatif”`);
  if (a.remove.length !== expect.removed || a.add.length !== expect.added) out.push(`the address carries ${a.remove.length} to take off and ${a.add.length} to put on, not ${expect.removed} and ${expect.added}`);
  if (a.others.length) out.push(`the address carries more than the change: ${a.others.map((k) => `“${k}”`).join(", ")}`);
  return out;
}

/**
 * A what-if's roster-move lines read as a trade card's (pure): the app words a what-if's moves with the card's own words, "this
 * trade" read as "this change" (whatIfView.ts whatIfWords), so the release contract (contracts.ts releaseLineProblems) reads
 * them back the other way. ⚠️ Ours: one wording, two readings.
 */
export function asTradeWords(line: string): string {
  return line.replace(/\b([Tt])his change\b/g, "$1his trade");
}

// ---------------------------------------------------------------------------------------------
// Section 5: Waiver upgrades' odds lines

/** One waiver row's "Details" as the page shows it (inPage7h.ts readWaiverRow), no names. */
export interface WaiverRowRead {
  found: boolean;
  /** The button's aria-expanded, and whether it names its panel (aria-controls) and the panel is there. */
  expanded: string | null;
  controls: boolean;
  /** The panel is hidden (the hidden attribute, or nothing rendered). */
  hidden: boolean;
  /** Keyboard focus is on the button. */
  focused: boolean;
  height: number;
  width: number;
  /** The odds lines' frame as seen ("without a pickup → with this one (from 20,000 simulated seasons)"), null without one. */
  frame: string | null;
  odds: OddsLineRead[];
  /** The panel's words, hover texts included (for FantasyCalc's values). */
  text: string;
  /** Where focus is, in words (for the details). */
  active: string;
}

/**
 * What's wrong with a row's "Details" across two taps (pure; the file header): before, a 44 px button with aria-expanded false
 * naming its panel, hidden; after a tap, expanded, the panel shown, focus on the button, and (on a rated list) my odds before
 * → after framed as the app frames them (`frame`: waiversView.ts ODDS_FRAME, then the seasons), the lines in order and in the
 * cards' forms; after another tap, folded again with focus kept. Empty when it reads as it should.
 */
export function waiverDetailsProblems(before: WaiverRowRead, open: WaiverRowRead, closed: WaiverRowRead, expect: { rated: boolean; frame: string; places: 2 | 3 | null }): string[] {
  if (!before.found) return ["the row has no “Details” button"];
  const out: string[] = [];
  if (before.height < 43.5 || before.width < 24) out.push(`“Details” is ${before.width} × ${before.height} px, under 44 px tall or 24 px wide`);
  if (before.expanded !== "false" || !before.hidden) out.push(`before a tap it's ${before.expanded === "true" ? "open" : `aria-expanded ${before.expanded ?? "missing"}`}${before.hidden ? "" : ", its panel shown"}`);
  if (!before.controls) out.push("its aria-controls doesn't name its panel");
  if (open.expanded !== "true" || open.hidden) out.push(`a tap didn't open it (aria-expanded ${open.expanded ?? "missing"}, panel ${open.hidden ? "hidden" : "shown"})`);
  if (!open.focused) out.push(`after a tap, keyboard focus is on ${open.active}, not “Details”`);
  if (expect.rated) {
    const frame = new RegExp(`^${expect.frame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(from [\\d,]+ simulated seasons\\)$`);
    if (!open.frame) out.push("its panel shows no odds lines (“Your odds: …”)");
    else {
      if (!frame.test(open.frame)) out.push(`its odds read “${open.frame}”, not “${expect.frame} (from N simulated seasons)”`);
      out.push(...oddsOrderProblems(open.odds.map((o) => o.label), expect.places, "its odds lines"));
      out.push(...oddsValueProblems(open.odds, "its odds lines"));
    }
  } else if (open.frame || open.odds.length) out.push("a list in points shows odds lines");
  if (closed.expanded !== "false" || !closed.hidden) out.push("another tap didn't fold it again");
  if (!closed.focused) out.push(`after another tap, keyboard focus is on ${closed.active}, not “Details”`);
  return out;
}

/** A waiver row's odds as the page holds them, hidden or not (inPage7h.ts READ_WAIVER_ODDS). */
export interface WaiverRowOdds {
  /** The move can't be made ("Can't add", "No room"). */
  blocked: boolean;
  /** Its panel holds the odds lines ("Your odds"). */
  odds: boolean;
  labels: string[];
}

/**
 * Which rows' odds lines are as they should be (pure; section 5: "each “Rest of season” row's details show the odds lines …";
 * "This week" and "Next week" stay in points): on a list rated by Helps you every move that can be made has them and a move
 * that can't none; on a list in points (a one-week list, a season list not rated) no row has them.
 */
export function waiverOddsCoverageProblems(rows: readonly WaiverRowOdds[], rated: boolean, list: string): string[] {
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (!rated && r.odds) out.push(`“${list}” (in points): row ${i + 1} shows odds lines`);
    else if (rated && r.blocked && r.odds) out.push(`“${list}”: row ${i + 1}, a move that can't be made, shows odds lines`);
    else if (rated && !r.blocked && !r.odds) out.push(`“${list}”: row ${i + 1} has no odds lines in its details`);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Section 3: the Thorough search

/**
 * The Thorough search switch's help (src/components/trades/TradeFinderPage.tsx thoroughHelp; a test ties the two): what it
 * checks, then "Takes about N seconds.".
 */
export const THOROUGH_HELP = /^Checks every trade of up to 2 players a side with every team, plus trades with 3 players a side, and plays out more of them\. Takes about (\d+) seconds\.$/;

/** The Thorough search switch as the page shows it (inPage7h.ts readThorough). */
export interface ThoroughSwitchRead {
  found: boolean;
  label: string | null;
  role: string | null;
  checked: boolean;
  /** Its help, the text aria-describedby names. */
  help: string | null;
  /** Its label's box (the tap target). */
  height: number;
  width: number;
}

/**
 * The switch's problems (pure): there, labeled `label`, a switch (role "switch"), on or off as `checked` says, a 44 px target,
 * its help the app's sentence with an estimate the page can have worked out (`seconds`: engine thorough.ts thoroughSeconds on
 * the normal searches this tab ran, or on none; empty: any whole number of seconds).
 */
export function thoroughSwitchProblems(r: ThoroughSwitchRead, expect: { label: string; checked: boolean; seconds: readonly number[] }): string[] {
  if (!r.found) return [`the Trade Finder has no “${expect.label}” switch`];
  const out: string[] = [];
  if (r.label !== expect.label) out.push(`the switch reads “${r.label ?? ""}”, not “${expect.label}”`);
  if (r.role !== "switch") out.push(`its role is “${r.role ?? "(none)"}”, not “switch”`);
  if (r.checked !== expect.checked) out.push(`it's ${r.checked ? "on" : "off"}, not ${expect.checked ? "on" : "off"}`);
  if (r.height < 43.5 || r.width < 24) out.push(`its label is ${r.width} × ${r.height} px, under 44 px tall or 24 px wide`);
  const help = THOROUGH_HELP.exec(r.help ?? "");
  if (!help) out.push(`its help reads “${r.help ?? "(none)"}”`);
  else if (expect.seconds.length && !expect.seconds.includes(Number(help[1]))) out.push(`its help says about ${help[1]} seconds, not ${expect.seconds.join(" or ")} as this tab's normal searches give`);
  return out;
}

/** The estimate in the switch's help, in seconds (pure), or null. */
export function thoroughEstimate(help: string | null): number | null {
  const m = THOROUGH_HELP.exec(help ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * The settings line under the controls while the Thorough search is on, and once it's off (pure; TradeFinderPage.tsx: the
 * search's settings, engine thorough.ts thoroughSettings): on, it starts "Up to `on` players a side"; off, it reads as before.
 */
export function thoroughSummaryProblems(before: string | null, on: string | null, after: string | null, wantOn: number): string[] {
  const out: string[] = [];
  if (!on || !on.startsWith(`Up to ${wantOn} players a side`)) out.push(`with the Thorough search on, the settings line reads “${on ?? ""}”, not “Up to ${wantOn} players a side…”`);
  if (after !== before) out.push(`turned off, the settings line reads “${after ?? ""}”, not “${before ?? ""}” as before`);
  return out;
}

/** An idea in a list, in words that tell it from another (its heading, players and numbers). */
export interface IdeaSummary {
  heading: string;
  give: string[];
  get: string[];
  helps: string | null;
  accept: string | null;
  overall: string | null;
}

/** An idea in one line (pure). */
export function ideaText(i: IdeaSummary): string {
  return `${i.heading}: ${i.give.join(" + ")} for ${i.get.join(" + ")} = ${i.helps ?? "?"} · ${i.accept ?? "?"} · ${i.overall ?? "?"}`;
}

/** Where two lists of ideas differ (pure): the count, then the first place they don't match. Empty when they're the same. */
export function sameIdeasProblems(before: readonly IdeaSummary[], after: readonly IdeaSummary[]): string[] {
  if (before.length !== after.length) return [`${before.length} ideas before, ${after.length} after`];
  for (let i = 0; i < before.length; i++) {
    const a = ideaText(before[i] as IdeaSummary);
    const b = ideaText(after[i] as IdeaSummary);
    if (a !== b) return [`idea ${i + 1} was “${a}”, now “${b}”`];
  }
  return [];
}

/** How many of `found`'s ideas aren't among `normal`'s (pure; by players given and got with their partner's heading). */
export function newIdeas(normal: readonly IdeaSummary[], found: readonly IdeaSummary[]): number {
  const key = (i: IdeaSummary) => `${i.heading}|${[...i.give].sort().join("+")}|${[...i.get].sort().join("+")}`;
  const known = new Set(normal.map(key));
  return found.filter((i) => !known.has(key(i))).length;
}

/** The ideas with more than `max` players on a side (pure; the Thorough search's ideas have up to 3 a side). */
export function oversizedIdeas(ideas: readonly IdeaSummary[], max: number): string[] {
  return ideas.flatMap((i, k) => (i.give.length > max || i.get.length > max ? [`idea ${k + 1}: ${i.give.length} for ${i.get.length}`] : []));
}

// ---------------------------------------------------------------------------------------------
// Section 1: the Trade Finder's ideas a phone screen, every card closed

/** The planner's goal (reply to Checkpoint 7g, §1): "With cards closed, the Trade Finder shows at least 2 ideas per screen." */
export const IDEAS_PER_SCREEN_GOAL = 2;

/** A box on the page in CSS px: its top and bottom from the top of the page, its left and right from the page's left edge. */
export interface PageBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * One idea of the Trade Finder's list as inPage7h.ts READ_CLOSED_IDEAS lays it out: its list item (the card and nothing else),
 * its "Trade idea N" and its heading (each null when it isn't found), whether the heading carries the "Helps both" tag, and
 * whether a panel of its card is open (Details or How to offer it).
 */
export interface ClosedIdeaRead {
  item: PageBox | null;
  eyebrow: PageBox | null;
  heading: PageBox | null;
  tagged: boolean;
  open: boolean;
}

/** What the closed ideas take on a phone (closedIdeasOf): numbers only, nothing that names a team. */
export interface ClosedIdeas {
  ideas: number;
  /** Each idea's height in px, rounded, in the list's order. */
  heights: number[];
  /** The space between two ideas in px: the mean of the list's gaps, to a tenth. */
  gap: number;
  /** What an idea takes on the page, its mean height plus the gap, rounded to the px. */
  perIdea: number;
  /** The phone screen's height ÷ what an idea takes, to two decimals: the ideas a screen. */
  perScreen: number;
  /** The ideas whose "Trade idea N" shares its heading's line (TradeCard.tsx: the row saves the eyebrow's own line only then). */
  beside: number;
  /** Of the others, those whose heading carries the "Helps both" tag (the two move as one piece, too wide for the row at 375 px). */
  apartTagged: number;
}

/**
 * The Trade Finder's ideas a phone screen with every card closed (pure; Checkpoint 7h, §1; the reviewers' measure: the screen's
 * height ÷ (the mean idea + the gap)), or why it can't be measured: fewer than 2 ideas (no space between ideas to read), an idea
 * the reader couldn't lay out, or a card with a panel open (the goal is about closed cards). "Trade idea N" shares its heading's
 * line when the heading starts above its bottom, to its right: on one row the two sit on one baseline, and a heading that
 * doesn't fit beside it starts right under it (TradeCard.tsx, no gap between the row's lines).
 */
export function closedIdeasOf(read: readonly ClosedIdeaRead[], screen: number): ClosedIdeas | { why: string } {
  if (read.length < 2) return { why: read.length ? "only 1 idea, so no space between ideas to measure" : "no idea in the list" };
  const boxes = read.map((r) => r.item);
  if (boxes.some((b) => b === null)) return { why: "an idea couldn't be laid out" };
  const open = read.filter((r) => r.open).length;
  if (open) return { why: `${open === 1 ? "1 idea has" : `${open} ideas have`} a panel open, so not every card is closed` };
  const items = boxes as PageBox[];
  const heights = items.map((b) => b.bottom - b.top);
  const gaps = items.slice(1).map((b, i) => b.top - (items[i] as PageBox).bottom);
  const gap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const per = heights.reduce((s, h) => s + h, 0) / heights.length + gap;
  const shares = (r: ClosedIdeaRead) => !!r.eyebrow && !!r.heading && r.heading.top < r.eyebrow.bottom - 0.5 && r.heading.left >= r.eyebrow.right - 0.5;
  return {
    ideas: read.length,
    heights: heights.map((h) => Math.round(h)),
    gap: Math.round(gap * 10) / 10,
    perIdea: Math.round(per),
    perScreen: Math.round((screen / per) * 100) / 100,
    beside: read.filter(shares).length,
    apartTagged: read.filter((r) => r.tagged && !shares(r)).length,
  };
}

/**
 * The card step's line for it (pure): what the ideas take with the space between them, the ideas a phone screen against the
 * planner's goal (judged on the two decimals printed), and on how many "Trade idea N" shares its heading's line, with how many
 * of the others carry the "Helps both" tag (a heading with its tag is too wide for the row at 375 px with almost any name: the
 * rest are kept apart by their team's name). Measured with the league's own team names on the page (steps7h.ts
 * closedIdeasChecks): the review of the first review's fix found that the dumps' "Team N" names always fit beside "Trade idea
 * N", while a longer name keeps the heading on a line of its own.
 */
export function closedIdeasText(m: ClosedIdeas): string {
  const goal = m.perScreen >= IDEAS_PER_SCREEN_GOAL ? ` (the planner's goal: at least ${IDEAS_PER_SCREEN_GOAL})` : `, under the planner's goal of at least ${IDEAS_PER_SCREEN_GOAL}`;
  const apart = m.ideas - m.beside;
  const tags = !m.apartTagged ? "" : ` (${m.apartTagged === apart ? (apart === 1 ? "it carries" : apart === 2 ? "both carry" : "all carry") : `${m.apartTagged} of them carry`} the “Helps both” tag)`;
  const shared = !apart
    ? m.ideas === 2
      ? "on both"
      : `on all ${m.ideas}`
    : !m.beside
      ? `on none of the ${m.ideas}: no heading fits beside it${tags}`
      : `on ${m.beside} of ${m.ideas}; on the ${apart === 1 ? "other" : `other ${apart}`} the heading doesn't fit beside it${tags}`;
  return (
    `with every card closed and the league's own team names on the page, the ${m.ideas} ideas take ${m.perIdea} px each, counting the space between them: ` +
    `${m.perScreen.toFixed(2)} ideas a phone screen${goal}; “Trade idea N” shares its heading's line ${shared}`
  );
}
