/**
 * Settings that the Fleaflicker JSON API does not expose, read from a league's public HTML rules
 * page (https://www.fleaflicker.com/nfl/leagues/{id}/rules): playoff teams/weeks/byes, trading
 * deadline, trade review period, league type, membership, keepers and the league-year calendar.
 *
 * The page is a label/value list. We only extract settings values; the page also shows the league
 * name and team names, so it is never printed or saved as a sanitized fixture.
 */

export interface PlayoffSettings {
  teams: number;
  firstWeek: number;
  lastWeek: number;
  byes: number;
  /** true = "re-seed each round", false = "no re-seeding", null = not stated. */
  reseed: boolean | null;
}

export interface HtmlRules {
  type?: string;
  membership?: string;
  tradeReviewPeriod?: string;
  tradingDeadline?: string;
  lifetime?: string;
  keepers?: number;
  seasonOpened?: string;
  nextSeasonOpens?: string;
  rosterTotals?: string;
  claimsResolved?: string;
  playoffs?: PlayoffSettings;
  /** The raw playoff line with dates stripped, for evidence. */
  playoffText?: string;
  /** "Individual Game Tiebreakers": how a tied game is decided, in order. */
  gameTiebreakers?: string[];
  /** "Break Regular Season Ties": Yes/No. */
  gameTiesBroken?: boolean;
  /** "Power & Playoff Rank Tiebreakers": how teams with the same record are ranked, in order. */
  rankTiebreakers?: string[];
  /** "Rank division winners higher" (playoff seeding): Yes/No. */
  divisionWinnersRankedHigher?: boolean;
  /** "Enforce Roster Minimums": Yes/No (per-position minimums in FetchLeagueRules rosterPositions[].min). */
  enforceRosterMinimums?: boolean;
  /** Labels we looked for and found (to tell "not set" from "page changed"). */
  foundLabels: string[];
}

export function htmlToLines(html: string): string[] {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  return noScripts
    .replace(/<(br|p|div|tr|li|h[1-6]|dt|dd|td|th)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const LABELS = [
  "Type",
  "Membership",
  "Trade Review Period",
  "Trading Deadline",
  "Lifetime",
  "Current Season Opened",
  "Next Season Opens",
  "How Are Claims Resolved",
  "Playoffs",
  "Calendar",
  "Roster Requirements",
  "Enforce Roster Minimums",
  "Individual Game Tiebreakers",
  "Break Regular Season Ties",
  "Power & Playoff Rank Tiebreakers",
  "Rank division winners higher",
] as const;

/**
 * Every settings label seen on the public rules page (2026-09-29). A list value (the tiebreakers)
 * ends at the next known label, or at a line followed by Yes/No (an unknown label).
 */
const KNOWN_LABELS = new Set<string>([
  ...LABELS,
  "Transaction Rules",
  "Prevent Cuts After Game Start",
  "Who is Placed on Waivers",
  "Free Agents During Preseason (After Draft)",
  "Lock Free Agents Before Draft",
  "Transaction Limits",
  "Waiver Claims",
  "Time on Waivers After Drop",
  "Prevent Waiver Churning",
  "Always-On During Preseason",
  "Process Game-Start Waivers On",
  "First-Come-First-Served",
  "Reset Order Weekly",
  "Miscellaneous",
  "Flea Eligible",
  "Lineup Locking",
  "Rosters",
  "Totals",
  "Tiebreakers",
  "Retroactively apply official stat changes (recommended)",
  "Schedule",
  "About",
]);

/**
 * A Fleaflicker page time such as "Tue 2/10/26 6:00 AM" (no zone shown: the site uses US Eastern
 * time) or "Tue 11/24/26 6:00 AM EST" → epoch ms. Parsed explicitly in America/New_York, so the
 * result doesn't depend on the machine's time zone, and PM hours are kept. null if it doesn't parse.
 */
export function parseEasternTime(text: string): number | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s+(EST|EDT|ET))?/i.exec(text);
  if (!m) return null;
  const [, mo, d, y, h, mi, ap, zone] = m;
  const year = (y ?? "").length === 2 ? 2000 + Number(y) : Number(y);
  const hour = (Number(h) % 12) + ((ap ?? "").toUpperCase() === "PM" ? 12 : 0);
  const wall = Date.UTC(year, Number(mo) - 1, Number(d), hour, Number(mi));
  const z = (zone ?? "").toUpperCase();
  if (z === "EST") return wall + 5 * 3_600_000;
  if (z === "EDT") return wall + 4 * 3_600_000;
  // Offset of New York at that wall time (two passes settle the DST switch hours).
  let utc = wall - easternOffsetMs(wall);
  utc = wall - easternOffsetMs(utc);
  return utc;
}

/** America/New_York UTC offset (ms, negative) at an instant. */
function easternOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

const PLAYOFF_LINE = /^(\d+)\s+Teams?\s*;\s*Weeks?:\s*(\d+)(?:\s*-\s*(\d+))?/i;

export function parsePlayoffLine(line: string): PlayoffSettings | null {
  const m = PLAYOFF_LINE.exec(line);
  if (!m) return null;
  const byes = /(\d+)\s+byes?\b/i.exec(line);
  const reseed = /re-seed each round/i.test(line) ? true : /no re-seeding/i.test(line) ? false : null;
  return { teams: Number(m[1]), firstWeek: Number(m[2]), lastWeek: Number(m[3] ?? m[2]), byes: byes ? Number(byes[1]) : 0, reseed };
}

export function parseRulesPage(html: string): HtmlRules {
  const lines = htmlToLines(html);
  const out: HtmlRules = { foundLabels: [] };
  const after = (label: string): string | undefined => {
    const i = lines.indexOf(label);
    return i >= 0 ? lines[i + 1] : undefined;
  };
  const yesNo = (label: string): boolean | undefined => {
    const v = after(label);
    return v === "Yes" ? true : v === "No" ? false : undefined;
  };
  const list = (label: string): string[] | undefined => {
    const i = lines.indexOf(label);
    if (i < 0) return undefined;
    const items: string[] = [];
    for (let j = i + 1; j < lines.length && items.length < 10; j++) {
      const line = lines[j] ?? "";
      if (KNOWN_LABELS.has(line) || line === "Yes" || line === "No" || /^(Yes|No)$/.test(lines[j + 1] ?? "")) break;
      items.push(line);
    }
    return items;
  };
  for (const l of LABELS) if (lines.includes(l)) out.foundLabels.push(l);
  out.gameTiebreakers = list("Individual Game Tiebreakers");
  out.gameTiesBroken = yesNo("Break Regular Season Ties");
  out.rankTiebreakers = list("Power & Playoff Rank Tiebreakers");
  out.divisionWinnersRankedHigher = yesNo("Rank division winners higher");
  out.enforceRosterMinimums = yesNo("Enforce Roster Minimums");
  out.type = after("Type");
  out.membership = after("Membership");
  out.tradeReviewPeriod = after("Trade Review Period");
  out.tradingDeadline = after("Trading Deadline");
  out.lifetime = after("Lifetime");
  out.seasonOpened = after("Current Season Opened");
  out.nextSeasonOpens = after("Next Season Opens");
  out.claimsResolved = after("How Are Claims Resolved");
  out.rosterTotals = lines.find((l) => /^\d+:\s*\d+\s+Starters/i.test(l));
  const keepers = /^(\d+)\s+Keepers?\b/i.exec(out.lifetime ?? "");
  if (keepers) out.keepers = Number(keepers[1]);
  else if (out.lifetime && /redraft/i.test(out.lifetime)) out.keepers = 0;
  const playoffLine = lines.find((l) => PLAYOFF_LINE.test(l));
  if (playoffLine) {
    out.playoffs = parsePlayoffLine(playoffLine) ?? undefined;
    out.playoffText = playoffLine
      .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\/\d{1,2}\s*-\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\/\d{1,2}\s*/g, "")
      .replace(/\s+([,;])/g, "$1");
  }
  return out;
}
