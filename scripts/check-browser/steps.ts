/**
 * The checks of `npm run check:browser`, page by page, in the order a user goes (each a step of the report):
 *
 * 1. Connect (/connect, a full load): the league link box and the Import button on the first screen (§14 item 1),
 *    the layout; then the public-link import with ESPN_LEAGUE_ID (and ESPN_SEASON when set), timed; and which path read
 *    the league (Part B, track BF: this browser, straight from ESPN, is expected for a public league without cookies; the
 *    saved import's readBy and the browser's own reads from ESPN, readPathOf).
 * 2. Import Report: the layout; the team: --team <id> picked in "Which team is yours?", else the report's own choice.
 * 3. League (the nav's link): built and timed; the layout; "Harder to get" never on my own players (my roster, my rows
 *    in the tables, "You could give" in the partner cards), and my team marked. The places it counts in must be found:
 *    a table row marked mine (one per table at most), and a "You could give" line in every partner card (the cards
 *    that link to the Trade Finder for their team). Then, on a NARROW_PHONE_WIDTH (320 px) phone for a moment, the
 *    header's first row keeps the logo, the Beta pill and the league switcher (review PG-4: the pill once pushed the
 *    switcher to a row of its own there, moving the page when it appeared); back at 375 px, its six links in two rows.
 *    Checkpoint 7h (the integration's track "league"): the page opens with the positional-strength heatmap and Best available
 *    closed under their headings and my roster card closed (its height noted in phone screens); the step opens them, and
 *    Best available's "Show all", with taps (focus kept on each button), measures the layout again, reads them, and closes
 *    them again at its end (openLeagueSections, closeLeagueSections; contracts.ts leagueSectionsProblems).
 *    Step "Notices" (Phase 7b) then reads the Import Report again (below).
 * 4. Trade Finder (the nav's link): a full search in the production worker, timed from the first progress update to
 *    the results (at most --max-search seconds, §12's 10 by default), with the engine's own per-stage timings; every
 *    card with its three numbers and both sides ("You give", "You get"); "Harder to get" never on a player I'd give;
 *    the layout. With no team picked: the page asks for one.
 * 5. Trade card (the first idea): the four sorts reorder the ideas without a new search (Chance they accept by the
 *    chance it goes through when the card shows one: the sort's own number, rank.ts; among the ideas that help); an
 *    outcome button (Rejected; on a card that shows two versions the first outcome asks which one, and the step picks the first) saves and clears; Report saves a reason and a
 *    note, and Undo removes it; the message's Copy puts it on the clipboard; the report form's tap targets. Checkpoint 7e (planner
 *    reply to Checkpoint 7d, item 4.1): last, every Plan B box reads "If they won't move: try …", and "How to offer it" on the
 *    first idea, opened, works its offers out (timed, `offersSeconds`) and holds the ladder's rules on the numbers it prints
 *    (contracts.ts offersProblems: the opening offer at least config.offers.openMinChance, each offer likelier than the one
 *    before by config.search.steps.minAcceptGain, Helps you above 0 and never rising), an offer that is another idea shown
 *    saying so with that idea's place ("Also shown as trade idea N.": contracts.ts offersAlsoProblems; the lead's call, wave
 *    D), since Checkpoint 7f none of its offers an idea below it on Overall (contracts.ts offersMergeProblems: the merge shows
 *    those among its offers only), since Checkpoint 7g its Last offer the idea plus one player of mine or the idea asking for
 *    fewer of their players (contracts.ts lastOfferShapeProblems) and no idea of the list a version of another's trade at
 *    least as good on both printed numbers (contracts.ts dominatedIdeasProblems), each offer's Copy putting its own message on
 *    the clipboard (offersChecks). Checkpoint 7h (planner reply to Checkpoint 7g, §1: cards closed by default): the step opens
 *    the first idea's Details (its feedback buttons, report form and "Open in Analyzer" are there) and "How to offer it" with a
 *    trusted tap on each control (openCardPanel); the card's own message, when "How to offer it" holds the trade alone, is
 *    copied there; the first offer's message shows open, the others open with a tap.
 * 6. Analyzer (the card's "Open in Analyzer"): it evaluates the same trade with the same three numbers as the card;
 *    both sides shown, no tag on mine; the layout; "Back to the Trade Finder" shows the ideas again. Then step "Waivers"
 *    (Phase 7b, below).
 * 7. Settings (the nav's link): the layout; a setting saves in this browser and "Reset to defaults" clears it.
 * 8. Second league (only with --second-league; Phase 4c, planner reply to Checkpoint 4b, change 11): the first idea gets
 *    an outcome (Sent); the switcher's "Add league" imports the public ESPN test league (args.ts SECOND_LEAGUE), whose
 *    names are added to the cleaning before anything is measured; then each page shows that league (the Import Report's
 *    and the League page's heading is its name, compared in the page; the trade pages ask for its team, with none of the
 *    first league's ideas; the Settings page's league card), a setting saved there stays its own, the first league's
 *    feedback stays the first league's; the switcher's layout with its panel open; back to the first league, every page
 *    shows it again (its ideas with their outcome, its own settings); a partner picked on its Trade Finder doesn't follow
 *    a switch to the test league (the address names that league's teams: review of track ML); then, from the test
 *    league's Trade Finder with a team in its address, Remove (with its confirmation) deletes the test league, the league
 *    shown, and what it saved, and nothing of the first league's; the tab moves to the first league, the status line says
 *    so, and its Trade Finder opens for every team, never on the removed league's address.
 * 9. The public pages (full loads; Part B, B3): Home, Privacy, Terms and Feedback (each its own step: the layout and its
 *    heading), an address the app doesn't have (the branded 404 page, its expected 404 the one failed request allowed),
 *    and the site's files, read from the home page: the production build's security headers (the full
 *    Content-Security-Policy, enforced or report-only, with the two league APIs in connect-src; no X-Powered-By), the
 *    manifest and its icons, the tab and iPhone icons, the sharing image, robots.txt and the sitemap. They need no
 *    league, so they run even when the import stopped the steps before them (`independent`).
 *
 * Checkpoint 7b (planner reply to Checkpoint 7a; contracts.ts holds the rules, inPage.ts the readers):
 * - FantasyCalc's conditions (5.4, reports/fantasycalc-permission.md: the UI never displays their values): no value number
 *   or value comparison on a Trade Finder or Analyzer card (its reasons, message, Plan B and "Details" included), each
 *   card crediting FantasyCalc ("These numbers weigh each player's trade value." then "Values: FantasyCalc") when values
 *   loaded; on the League page no "Value" column or "~" estimate in the player tables, no number of the trade market's or
 *   value comparison anywhere on the page (every breakdown opened, read and closed again; hover texts included), the
 *   market blend in words; every link to FantasyCalc with rel exactly "noopener" and referrerpolicy "origin", and (step
 *   "FantasyCalc links", with the public pages) one in the footer of every app page's own server HTML, fetched with a
 *   plain GET before any script runs.
 * - Notices (§5.1): the Import Report (step 2, and again as step "Notices" once the League page has loaded the
 *   projections) shows no warning code, JSON path or field name, stat ID or player-ID matching above its technical details
 *   (closed parts and hover texts included), which are closed and its last section, its "Notices" tile and "Things to
 *   know" card agreeing; the League page (its breakdowns too) and the Trade Finder show none anywhere, their banner or
 *   warnings box titled "Things to know". With --team (Parker's league): no notice, no banner, and the planner's quiet
 *   line for the two rare uncounted rules: when his league's data differs, an "info" line says what it shows (never a
 *   failure).
 * - The Trade Finder's freshness line when the saved inputs have a time to say, and "Best time to look:" in season before
 *   the deadline (5.3; tradeView.ts freshnessText, inTradingSeason and bestTimeText decide when and what).
 * - Step "Waivers" (§6.2), after the Analyzer, from the Trade Finder: the header's Waivers link reveals "Waiver upgrades"
 *   (in view, its heading focused), again from the top without a new history entry; its toggle (2 or 3 lists, 44 px
 *   buttons, aria-pressed following a tap) and "Show all N" (aria-expanded); the header's six links in two rows at 375 px
 *   (the League step). Checkpoint 7e (planner reply to Checkpoint 7d, items 3.1–3.4): "Rest of season" rated on its own
 *   request ("Rating these against your odds…" gone, the time noted), the "Drop from the same position" switch with its
 *   help, every row one move ("Add" him, "Drop" the player named with a lock next to him), Helps you on the season list and
 *   the lineup gain on the one-week list (waiverMoveChecks). Checkpoint 7f (planner reply to Checkpoint 7e, item 3), on every
 *   list of the toggle (review of Checkpoint 7f, WAIVERS-5: three while a week is under way): above the fold only the rows that
 *   help, their main number above 0 ("+0.1 pts" or more, parsed), then the moves that can't be made (or the line saying none
 *   helps); every row of the list above the fold or counted by the fold (its data-waiver-total: a fold gone missing fails);
 *   then "N more pickups that don't help you (show)", 44 px, collapsed; a tap shows as many "No gain" rows as it says right
 *   after its block, "(hide)" with aria-expanded true and aria-controls naming them, keyboard focus kept on the button; another
 *   tap folds them, focus kept (waiverListChecks; contracts.ts waiverSplitProblems, waiverFoldProblems, waiverTotalProblems);
 *   with the fold open, no trade value in the section (pageValueLeaks: the League step's scan no longer reaches the folded
 *   rows), the section's layout once, and a tap on the toggle to another list and back folds it again. "Show all N" counts the
 *   rows above the fold, so it's checked only when more show there than at first.
 * - Settings (5.2, §6.1, §2 question 5): "What does your league reward?" with the planner's three answers and hint; the
 *   read-only playoff weight going from "Working it out…" to "N.N×, set automatically from your odds." within about 15 s,
 *   worked out by the page's own engine worker without a request off the site; "Protect my trade value" without a number.
 * - The Analyzer's "Back to the Trade Finder" isn't prefetched: with a partner in the Finder's address, no request names
 *   the link's address until it's tapped (page.ts logs every request to the app).
 *
 * Checkpoint 7c (planner reply to Checkpoint 7b, §6, league prizes; contracts.ts decides):
 * - Settings: "Several prizes" shows "Your league's prizes" (a group of its own, the goal's keeping its three answers): the
 *   planner's five prizes and helper line, 44 px fields reading the saved amounts, and the app's own split line for them;
 *   a new amount typed with Enter saves and the split follows; text a field can't read says why (aria-invalid, its
 *   message) and isn't saved; then the odds lines under it (below), and the answer it had is chosen again
 *   (settingsPrizeChecks).
 * - "Helps both" (§7; contracts.ts decides): the card step's four sorts (Helps you, Chance they accept, Helps both, then
 *   Overall, the page left in its default order) never search again; in every sort the "Helps both" tag is on exactly the
 *   cards that help both teams as printed (Helps you and Helps them each at least config.benefit.helpsThemMin since Checkpoint
 *   7d, planner reply to Checkpoint 7c, answer 5); the "Helps both" sort shows only those, by Helps you, its status line saying
 *   how many ("Found 2 trade ideas that help both teams.", "No trades help both teams right now."); every card's partner's line
 *   names their odds in the format of mine (with cardOddsChecks, so under "Several prizes" too). FINDER_DONE reads every status
 *   the Finder's done state can show, whatever sort a remembered Finder opens in.
 *
 * Checkpoint 7d (planner reply to Checkpoint 7c; contracts.ts decides): answer 3, in every sort a Trade Finder card shows the
 * partner's line exactly when it's tagged "Helps both", never in a Plan B box (finderPartnerLineProblems), and
 * the Analyzer's card shows it whatever it is, the same number as the Finder's card when that one showed it, with the same tag,
 * and that tag the one its own printed scores call for (analyzerPartnerLineProblems; review of Checkpoint 7d, cards-export-3:
 * only the Analyzer's card prints both scores of an untagged idea); "Also", step "DynastyProcess link" with the public pages:
 * every app page's server HTML credits DynastyProcess in its footer with a link to its data repository
 * (dynastyProcessLinkIssues).
 * - The odds lines on every Trade Finder card (and Plan B box) and the Analyzer's card, and my odds on the League page:
 *   "Top 3 odds" (or "Top 2 odds") exactly when the tab's saved settings pay 3rd (2nd) place under "Several prizes"
 *   (tradeView.ts topPlacesOf on them). The League, Trade Finder and Analyzer steps run in a fresh browser, under "Only the
 *   champion", so there they see the line absent; the Settings step, with "Several prizes" saved (its prefilled 3rd place
 *   paid), goes back to the League page, the Trade Finder (the search the new setting starts) and the Analyzer's card for
 *   its first idea to see it present (prizeOddsChecks; review of the prizes UI, prizes-ui-1: the line was never seen live).
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2, "Now or after this week"; contracts.ts nowOrLaterProblems): the card
 *   step waits until every Trade Finder card's later numbers are in (the list's data-now-or-later), then holds each line it
 *   shows to "Helps you 37 now · 41 if done after this week's games.": its card's own Helps you first, the two more than
 *   config.explain.nowOrLaterMin apart, the planner's tooltip, and the same words right under it in the card's Details
 *   (Checkpoint 7h; until then among the card's facts: a phone shows those); the Analyzer step holds its card's line, which comes with its evaluation, to the same (nowOrLaterChecks).
 * Checkpoint 7h (planner reply to Checkpoint 7g; steps7h.ts holds the checks, contracts7h.ts their rules, inPage7h.ts the
 *   readers): step "What if" after the Analyzer (section 4: the Analyzer's "What if" mode, a change built from the page's own
 *   lists and evaluated, its result held to the planner's words and the cards' odds forms, no trade offer's parts); in step
 *   "Waivers" each list's odds lines and a "Rest of season" row's "Details" opened and closed with focus kept (section 5:
 *   waiverDetailsChecks, from waiverMoveChecks); step "Thorough search" after Waivers (section 3: the switch off by default with
 *   its estimate, a Thorough search run to the end and timed in an info line, the normal search's ideas back at once); under
 *   "Several prizes" the waiver rows' and the what-if's top-N line too (prizeOddsChecks).
 * After each step: no console errors (page or worker), CSP violations (Part B: enforced or report-only, page or worker),
 * uncaught exceptions, failed requests to the app, or requests to any other site. Screenshots, when on, go to the shots folder after the page's names are replaced with placeholders,
 * put back right after (one that can't be saved is a skip: it's a record to look at, not a check of the app). Checkpoint 7g
 * (planner reply to Checkpoint 7f, item 5): the clutter check's four screenshots (shots.ts): the whole Trade Finder at the card
 * step's start, its first idea with everything on it opened at the step's end, then the whole League page and Waiver upgrades
 * at the Waivers step's end, each in images a little under two phone screens tall; --no-shots turns them off with the rest.
 *
 * Texts these checks look for are the app's own (status lines, headings, button names); when one changes, the check
 * that reads it fails loudly rather than passing by accident: a check that counts something somewhere first checks it
 * found that somewhere. Page texts come back whole: the entry point cleans them, then cuts them (report.ts).
 *
 * What the app saved is read from its league store (Phase 4c: IndexedDB "offersheet", inPage.ts storeRows), never by
 * opening it in a way that would create it. A saved league's id (a short hash of its league id, and its season) stays
 * in the page and in this process: it's compared, never printed or written.
 */
import { GOAL_LABEL, PRIZE_LABEL, PRIZE_TEXT_MESSAGES, PRIZES_HELP, prizeAmountText, prizeSplitText } from "@/components/settings/settingsView";
import { config } from "@/engine/config";
import type { MarketInputs } from "@/engine/inputs";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import { rewardOf, rewardWith } from "@/engine/reward";
import { GOALS, PRIZE_KEYS, normalizeTradeSettings, type TradeSettings } from "@/engine/settings";
import { ANALYZER_SUGGESTED_LABEL, NOW_OR_LATER_TITLE, OFFER_STEP_LABEL, PLAN_B_HEADING, bestTimeText, freshnessText, inTradingSeason, topPlacesOf } from "@/lib/tradeView";
import { RATING_FAILED_TEXT, RATING_PENDING_TEXT, SAME_POSITION_HELP, SAME_POSITION_LABEL } from "@/lib/waiversView";
import { LEAGUE_ID_PLACEHOLDER, mergeLeagueNames, nameRules, type CheckReport, type LeagueNames } from "./report";
import {
  CHECKED_GOAL,
  cleanCall,
  goalChoice,
  PLAYOFF_WEIGHT_SHOWN,
  READ_CARD_ODDS,
  READ_CARD_TEXTS,
  READ_FANTASYCALC_LINKS,
  READ_FINDER_NOTICES,
  READ_FINDER_TIMING,
  READ_IMPORT_NOTICES,
  READ_LEAGUE_VALUES,
  READ_MY_ODDS,
  READ_NAV_LINKS,
  READ_NOTICE_BANNERS,
  READ_PRIZE_LEAGUE,
  READ_RELEASE_LINES,
  READ_SETTINGS_PRIZES,
  READ_SETTINGS_SCORING,
  READ_TRADING_LEAGUE,
  READ_WAIVERS,
  READ_WAIVERS_TEXT,
  sanitizeCall,
  STOP_PLAYOFF_WEIGHT,
  typePrize,
  WAIVER_REST,
  WAIVER_SHOW_ALL,
  waiverToggle,
  WATCH_PLAYOFF_WEIGHT,
} from "./inPage";
import { SECOND_LEAGUE, type CheckBrowserArgs } from "./args";
import {
  APP_PAGES,
  BLEND_WORDS,
  creditProblems,
  fantasyCalcLinkIssues,
  fantasyCalcLinksInHtml,
  freshnessLineOk,
  headlineTopProblems,
  analyzerPartnerLineProblems,
  DYNASTYPROCESS_DATA_URL,
  dynastyProcessLinkIssues,
  dynastyProcessLinksInHtml,
  dominatedIdeasProblems,
  finderPartnerLineProblems,
  helpsBothListProblems,
  helpsBothStatusOk,
  helpsBothTagProblems,
  invalidPrizeProblems,
  lastOfferShapeProblems,
  MENTIONS_MARKET,
  NAV_HREFS,
  noticeCount,
  noticeLeaks,
  nowOrLaterProblems,
  oddsLabelProblems,
  offersAlsoProblems,
  offersMergeProblems,
  offersProblems,
  pageValueLeaks,
  PARKER_QUIET_LINE,
  PLAYOFF_WEIGHT_RANGE,
  playoffWeightRead,
  prizeGroupProblems,
  RELEASE_REASON_MARK,
  releaseLineProblems,
  requestNamesAddress,
  rowCount,
  tradeKeyParts,
  valueLeaks,
  VALUES_CREDIT,
  waiverFoldProblems,
  waiverMoveProblems,
  waiverRowHelps,
  waiverSplitProblems,
  waiverToggleKind,
  waiverTotalProblems,
  type CreditRead,
  type FantasyCalcLink,
  type IdeaRead,
  type NowOrLaterRead,
  type OffersRead,
  type PrizeGroupRead,
  type WaiverFoldRead,
  type WaiverMoveRead,
} from "./contracts";
import type { AppRequest, PageEvent, PageSession } from "./page";
import { finderShot, leagueShots, openedCardShot } from "./shots";
// Checkpoint 7h, the integration's track "league": what the League step opens to read, and the contract on it.
import { FREE_AGENTS_ALL, MY_ROSTER_SUMMARY, READ_LEAGUE_SECTIONS, leagueDisclosure } from "./inPage";
import { LEAGUE_DISCLOSURES, leagueSectionsProblems, type LeagueSectionsRead } from "./contracts";
import { PHONE } from "./page";
import { thoroughStep, waiverDetailsChecks, waiverPrizeOddsChecks, whatIfPrizeOddsChecks, whatIfStep } from "./steps7h";

export interface CardInfo {
  heading: string;
  give: Array<{ name: string; text: string; tagged: boolean }>;
  get: Array<{ name: string; text: string; tagged: boolean }>;
  tagsOnMySide: number;
  helps: string | null;
  /** The big "Chance they accept" number (P_accept). */
  accept: string | null;
  /** "about N% it goes through" under the numbers when the league's review could veto it (P_complete), else null. */
  acceptThrough: string | null;
  overall: string | null;
  /** Checkpoint 7c: Helps them as printed on the partner's line ("24", "0"), null without the line. */
  helpsThem: string | null;
  /** The labels of their odds on that line ("Their title odds", …), null without it. */
  theirOdds: string[] | null;
  /** The "Helps both" tag shows with the card's heading. */
  helpsBothTag: boolean;
  /** Checkpoint 7d: the card's Plan B box ("If they won't move: try …" since Checkpoint 7e) shows a partner's line (it never may). */
  planBHelpsThem: boolean;
  analyzerHref: string | null;
  /** The card's Analyzer link opens the card's own trade (its key's partner and players). */
  linkIsOwnTrade: boolean;
  hasPitch: boolean;
  feedback: Array<{ label: string; pressed: boolean }>;
}

export interface Measure {
  pageOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  loose: string[];
  looseCount: number;
  small: string[];
  smallCount: number;
  targets: number;
}

export interface StepContext {
  page: PageSession;
  report: CheckReport;
  args: CheckBrowserArgs;
  /** ESPN_LEAGUE_ID: typed into the page, never printed. */
  leagueId: string;
  /** ESPN_SEASON, when set. */
  season: string | undefined;
  /** Where screenshots go; null: none. */
  shotsDir: string | null;
  /** The imported league's names (null until the import): screenshots replace them, and the league id, with placeholders. */
  names: LeagueNames | null;
  /** Called once the imported league's names are known (the entry point cleans the output with them). */
  onNames: (names: LeagueNames) => void;
  /** My team's id once known (null: none picked). */
  myTeam: string | null;
  /** The League page was built in this run (its model inputs are saved and fresh: the Settings page's playoff weight reads them). */
  leagueReady: boolean;
  /** The Trade Finder's first card, for the Analyzer's comparison. */
  firstCard: CardInfo | null;
  /** Why the remaining steps can't run (a failed import), or null. */
  stop: string | null;
  /** Screenshot files written. */
  shots: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seconds = (ms: number) => Math.round(ms / 100) / 10;
const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The in-page mark every timeline is measured from. */
export async function mark(page: PageSession): Promise<number> {
  return page.run<number>("return performance.now();");
}

/**
 * The in-page prelude that defines clean(text) for a reader (inPage.ts cleanCall): the league's names and id replaced by
 * report.ts's rules, so what comes back carries placeholders, never a name.
 */
export function cleaning(ctx: StepContext): string {
  return cleanCall(nameRules(ctx.names, [[ctx.leagueId, LEAGUE_ID_PLACEHOLDER]]));
}

/**
 * Whether Parker's own expectations apply (Phase 7b: his league's notices, as the planner expects them): the run is on his
 * league (ESPN_LEAGUE_ID, the first league) with his team picked through --team. Without --team they're left out.
 */
export function parkersLeague(args: Pick<CheckBrowserArgs, "team">): boolean {
  return args.team !== null;
}

/**
 * Waits until the main area's text stops changing (the same 4 times, 300 ms apart), at most `maxMs`: a page that reads
 * saved data after its first render (the Import Report's model inputs) has shown it. Only a hash of the text comes back.
 */
async function settle(page: PageSession, maxMs = 8_000): Promise<void> {
  const started = Date.now();
  let last = "";
  let same = 0;
  while (Date.now() - started < maxMs && same < 3) {
    const now = await page
      .run<string>(`const m = document.querySelector("main"); const t = m ? m.textContent || "" : ""; let h = 5381; for (let i = 0; i < t.length; i++) h = (h * 33 + t.charCodeAt(i)) | 0; return t.length + ":" + h;`)
      .catch(() => "");
    same = now === last ? same + 1 : 0;
    last = now;
    await sleep(300);
  }
}

/** The layout's two checks; `lead` starts their lines when a step measures twice (the waiver view with a fold open). */
export function layoutChecks(ctx: StepContext, step: string, m: Measure, where = "the page", lead = ""): void {
  const sideways = m.pageOverflow ? `${where} scrolls sideways (${m.scrollWidth} px wide at ${m.clientWidth} px)` : `${pl(m.looseCount, "element")} reach past the right edge`;
  ctx.report.check(step, !m.pageOverflow && m.looseCount === 0, `${lead}no sideways scrolling at ${m.clientWidth} px`, `${lead}${sideways}`, m.loose);
  ctx.report.check(step, m.smallCount === 0, `${lead}tap targets at least 44 px tall (${m.targets} checked)`, `${lead}${pl(m.smallCount, "tap target")} under 44 px tall or 24 px wide`, m.small);
}

export async function measurePage(ctx: StepContext): Promise<Measure> {
  return ctx.page.run<Measure>("return measure();");
}

export async function screenshot(ctx: StepContext, name: string): Promise<void> {
  if (!ctx.shotsDir) return;
  try {
    ctx.shots.push(...(await ctx.page.screenshots(ctx.shotsDir, name, sanitizeCall(nameRules(ctx.names, [[ctx.leagueId, LEAGUE_ID_PLACEHOLDER]])))));
  } catch (err) {
    // A screenshot is a record for a person to look at, not a check of the app: a failed one is a skip.
    ctx.report.skip(ctx.page.step, `the screenshot "${name}" couldn't be saved (${err instanceof Error ? err.name : "error"}; --no-shots turns them off)`);
  }
}

/**
 * The step's console errors, CSP violations, exceptions, failed requests and requests to other sites, as one check.
 * `expected` names events the step causes on purpose (the missing page's own 404), which don't count.
 */
export function healthCheck(ctx: StepContext, step: string, expected: (e: PageEvent) => boolean = () => false): void {
  const events = ctx.page.eventsOf(step).filter((e) => !expected(e));
  // The browser's own reads of a league from ESPN or Sleeper (Part B, track BF) are expected, and counted.
  const reads = events.filter((e) => e.kind === "platform read").length;
  if (reads) ctx.report.note(step, "platformReads", reads);
  const bad = events.filter((e) => e.kind !== "console warning" && e.kind !== "platform read");
  const warnings = events.filter((e) => e.kind === "console warning").length;
  if (warnings) ctx.report.note(step, "consoleWarnings", warnings);
  ctx.report.check(
    step,
    bad.length === 0,
    "no console errors, CSP violations, failed requests or requests to other sites",
    `${pl(bad.length, "problem")} in the browser`,
    bad.map((e) => `${e.kind} (${e.where}): ${e.text}`),
  );
}

// ---------------------------------------------------------------------------------------------
// Checkpoint 7b's shared checks (planner reply to Checkpoint 7a; inPage.ts reads, contracts.ts decides)

interface ImportNotices {
  before: string;
  details: { tag: string; open: boolean; summary: string } | null;
  after: string[];
  tile: string | null;
  card: string[] | null;
  scoring: boolean;
  quiet: string[];
  notCounted: string | null;
}

/** The technical details' summary (§5.1: "a collapsed 'Technical details (for bug reports)' section at the bottom"). */
export const TECHNICAL_DETAILS = "Technical details (for bug reports)";

/**
 * The Import Report's notices (§5.1). Contract, any league: no warning code, JSON path, stat ID or player-ID matching in
 * what a user sees or hears above the technical details; those closed on arrival and the page's last section; the
 * "Notices" tile and the "Things to know" card agree. Parker's league (`parkers`): no notice (the tile reads "None", no
 * card) and the scoring card's quiet line in the planner's words, as info lines when his league's data differs.
 */
export async function importNoticeChecks(ctx: StepContext, step: string, opts: { parkers: boolean; where?: string }): Promise<void> {
  const { page, report } = ctx;
  const where = opts.where ?? "the Import Report";
  const r = await page.run<ImportNotices>(cleaning(ctx) + READ_IMPORT_NOTICES);
  const leaks = noticeLeaks(r.before);
  report.check(step, leaks.length === 0, `${where} shows no warning code, JSON path, stat ID or player-ID matching above its technical details`, `${where} shows internal text above its technical details (it belongs in them)`, leaks);
  const d = r.details;
  report.check(
    step,
    !!d && d.tag === "details" && !d.open && d.summary === TECHNICAL_DETAILS && r.after.length === 0,
    `“${TECHNICAL_DETAILS}” is closed on arrival and ${where}'s last section`,
    !d
      ? `${where} has no technical details (details#technical-details)`
      : d.tag !== "details"
        ? `#technical-details is a <${d.tag}>, not a <details>`
        : d.open
          ? "the technical details are open on arrival"
          : d.summary !== TECHNICAL_DETAILS
            ? `the technical details' summary reads “${d.summary}”`
            : `${pl(r.after.length, "section")} after the technical details`,
    r.after,
  );
  const n = noticeCount(r.tile);
  const listed = r.card?.length ?? 0;
  report.check(
    step,
    n !== null && (n === 0 ? r.card === null : listed === n),
    `the Notices tile (“${r.tile ?? ""}”) and the Things to know card agree`,
    n === null
      ? r.tile === null
        ? "no Notices tile"
        : `the Notices tile reads “${r.tile}”`
      : n === 0
        ? `the Notices tile reads None, but a Things to know card lists ${pl(listed, "notice")}`
        : `the Notices tile says ${n}, the Things to know card lists ${listed}`,
    r.card ?? [],
  );
  if (!opts.parkers) return;
  // Parker's league: what the planner expects of his data (an info line when it differs, never a failure).
  if (n === 0 && r.card === null) report.ok(step, "Parker's league: no notices (the tile reads None, and there's no Things to know card), as the planner expects");
  else report.info(step, `Parker's league shows ${n === null ? "notices" : pl(n, "notice")} (the planner expected none): the league's data changed, or a notice is new`, r.card ?? []);
  if (!r.scoring) report.info(step, "Parker's league: couldn't find the scoring card (its heading “How players score”) to read its quiet line");
  else if (r.quiet.length === 1 && r.quiet[0] === PARKER_QUIET_LINE && r.notCounted === null) report.ok(step, `the scoring card says the rare uncounted rules quietly: “${PARKER_QUIET_LINE}”`);
  else
    report.info(step, "Parker's league: the scoring card's uncounted rules read differently from the planner's line (a rule is new, or one has scored this season)", [
      ...r.quiet.map((q) => `quiet line: ${q}`),
      ...(r.notCounted ? [`“Not counted yet” box: ${r.notCounted}`] : []),
      `expected: ${PARKER_QUIET_LINE}`,
    ]);
}

/**
 * The League page's notices (§5.1): its "Things to know" banner speaks plainly when it's there, nothing on the page shows
 * a code, path or stat ID (its closed parts and hover texts included: the technical details are the Import Report's
 * alone); Parker's league (`parkers`) shows no banner (an info line when it does).
 */
export async function leagueNoticeChecks(ctx: StepContext, step: string, opts: { parkers: boolean; where?: string }): Promise<void> {
  const { page, report } = ctx;
  const where = opts.where ?? "the League page";
  const r = await page.run<{ banners: Array<{ items: string[]; text: string }>; page: string }>(cleaning(ctx) + READ_NOTICE_BANNERS);
  if (r.banners.length) {
    const leaks = r.banners.flatMap((b) => noticeLeaks(b.text));
    report.check(step, leaks.length === 0, `${where}'s Things to know banner speaks plainly: no code, path or stat ID`, `${where}'s Things to know banner shows internal text`, leaks);
  }
  const leaks = noticeLeaks(r.page);
  report.check(step, leaks.length === 0, `${where} shows no warning code, JSON path, stat ID or player-ID matching anywhere (closed parts and hover texts included)`, `${where} shows internal text (it belongs in the Import Report's technical details)`, leaks);
  if (!opts.parkers) return;
  if (!r.banners.length) report.ok(step, "Parker's league: no Things to know banner, as the planner expects");
  else report.info(step, "Parker's league shows a Things to know banner (the planner expected none, unless a player without a Sleeper id is a likely starter)", r.banners.flatMap((b) => b.items));
}

interface LeagueValues {
  tables: number;
  roster: number;
  headers: string[];
  tilde: string[];
  titles: string[];
  rows: number;
  /** The breakdowns closed at first (each opened for the reading). */
  closed: number;
  opened: number;
  breakdowns: string[];
  /** Every word on the page (closed parts and hover texts included) while every breakdown was open. */
  page: string;
  leftOpen: number;
  valuesLine: string | null;
}

/** A text's words around its first mention of the trade market, for a failure's details. */
function aroundMarket(text: string): string {
  const at = text.search(MENTIONS_MARKET);
  return at < 0 ? text.slice(0, 120) : `${at > 60 ? "…" : ""}${text.slice(Math.max(0, at - 60), at + 90)}…`;
}

/**
 * FantasyCalc's values on the League page (5.4): no "Value" column or "~" estimate in the roster and free-agent tables; no
 * number of the trade market's and no value comparison anywhere on the page, every player's breakdown open (each opened,
 * read, then closed again) and every hover text included; no code in a breakdown (§5.1: a breakdown is built only while
 * it's open, so the notices' own scan of the page never sees one); and the market blend said in words ("toward the trade
 * market's view", "barely moves"; an info line when it reached nobody).
 */
export async function leagueValueChecks(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const v = await page.run<LeagueValues>(cleaning(ctx) + READ_LEAGUE_VALUES, { timeoutMs: 120_000 });
  report.note(step, "breakdownsOpened", v.opened);
  if (
    !report.check(
      step,
      v.roster > 0,
      `found the rosters' player tables (${v.roster}) and the best free agents' (${v.tables - v.roster})`,
      "couldn't find the rosters' player tables (captions ending “players with rest-of-season points”): the trade-value checks below can't be trusted",
    )
  )
    return;
  const valueHeads = v.headers.filter((h) => /\bvalues?\b/i.test(h));
  report.check(step, valueHeads.length === 0 && v.tilde.length === 0, "no Value column and no “~” estimate in the roster and free-agent tables", "the player tables show trade values", [
    ...valueHeads.map((h) => `a column headed “${h}”`),
    ...v.tilde.map((c) => `a cell reading “${c}”`),
  ]);
  // Where the scan below must reach: every breakdown, opened (they're built only while open) and closed again.
  report.check(
    step,
    v.opened > 0 && v.opened === v.closed && v.leftOpen === 0,
    `opened every player's breakdown (${v.opened} of ${v.rows}) to read it, and closed them again`,
    v.opened === 0
      ? "no player's breakdown opened, so they couldn't be read: the trade-value checks below can't be trusted"
      : v.opened < v.closed
        ? `only ${v.opened} of the ${v.closed} closed breakdowns opened when tapped, so the others couldn't be read`
        : `${v.leftOpen} breakdown(s) didn't close again`,
  );
  const leaks = pageValueLeaks(v.page);
  report.check(
    step,
    leaks.length === 0,
    "no trade-market number or value comparison anywhere on the League page (every breakdown open, hover texts included)",
    `${pl(leaks.length, "trade value")} on the League page: Offer Sheet never displays FantasyCalc's values (their condition 4)`,
    leaks,
  );
  const codes = [...new Set(v.breakdowns.flatMap(noticeLeaks))];
  report.check(
    step,
    codes.length === 0,
    "no warning code, JSON path or stat ID in any player's breakdown",
    "the players' breakdowns show internal text (it belongs in the Import Report's technical details)",
    codes,
  );
  const mentions = [...v.breakdowns, ...v.titles].filter((t) => MENTIONS_MARKET.test(t));
  const unworded = mentions.filter((t) => !BLEND_WORDS.test(t)).map(aroundMarket);
  const blended = v.breakdowns.filter((t) => BLEND_WORDS.test(t)).length;
  if (!mentions.length) {
    if (v.valuesLine && /unavailable right now/.test(v.valuesLine)) report.skip(step, "the market blend's words: FantasyCalc's values aren't loaded, so no projection leans toward the trade market");
    else report.info(step, "no player's breakdown mentions the trade market: the market blend reached nobody this time (its words would be “toward the trade market's view” or “barely moves”)");
    return;
  }
  report.check(
    step,
    unworded.length === 0,
    `the market blend is said in words in ${blended} ${blended === 1 ? "player's breakdown" : "players' breakdowns"} (“toward the trade market's view”, “barely moves”)`,
    `${pl(unworded.length, "breakdown or hover text")} mention the trade market without saying which way in words`,
    unworded,
  );
}

interface CardText {
  text: string;
  credit: CreditRead | null;
}

/** What the timing lines and the cards' credit depend on (inPage.ts READ_TRADING_LEAGUE). */
export interface TradingLeague {
  settings: { regularSeasonWeeks: number[]; playoffWeeks: number[]; tradeDeadline: LeagueSettings["tradeDeadline"]; tradeReviewHours: number | null };
  currentWeek: number;
  leagueWeek: number | null;
  lastWeek: number | null;
  kickoffs: Record<number, Record<string, string>> | null;
  /** The tab's league has saved model inputs. */
  inputs: boolean;
  /** Its saved model inputs carry trade values (FantasyCalc's, or our estimates from an older list of theirs). */
  hasMarket: boolean;
  /** When FantasyCalc's list in them was fetched (MarketInputs.fetchedAt), and their sources' stamps (ModelInputs.sources). */
  marketFetchedAt?: string | null;
  sources?: Array<{ source: string; fetchedAt: string }>;
}

async function readTradingLeague(ctx: StepContext): Promise<TradingLeague | null> {
  return ctx.page.run<TradingLeague | null>(READ_TRADING_LEAGUE).catch(() => null);
}

/**
 * Whether the Trade Finder should say when to look, and in what words (pure; planner reply to Checkpoint 7a, 5.3): the
 * app's own rules (tradeView.ts inTradingSeason: the season started, a week left, the deadline not passed; bestTimeText:
 * the league's review period) on the tab's saved league.
 */
export function bestTimeExpectation(l: TradingLeague, now: Date): { inSeason: boolean; text: string } {
  const settings = { regularSeasonWeeks: l.settings.regularSeasonWeeks, playoffWeeks: l.settings.playoffWeeks, tradeDeadline: l.settings.tradeDeadline } as unknown as LeagueSettings;
  const inSeason = inTradingSeason({ settings, currentWeek: l.currentWeek, ...(l.leagueWeek !== null ? { leagueWeek: l.leagueWeek } : {}) }, now, {
    ...(l.lastWeek !== null ? { lastWeek: l.lastWeek } : {}),
    ...(l.kickoffs ? { nfl: { kickoffs: l.kickoffs } } : {}),
  });
  return { inSeason, text: bestTimeText(l.settings.tradeReviewHours === null ? {} : { tradeReviewHours: l.settings.tradeReviewHours }) };
}

/**
 * The freshness line the Trade Finder should show (pure; 5.3), by the app's own rule (tradeView.ts freshnessText) on the
 * tab's saved inputs at `now`: null when they carry neither FantasyCalc's time nor the projections' stamp (nothing to say),
 * else the line, whose "… ago" words the check reads loosely (the page worked them out a moment earlier).
 */
export function freshnessExpectation(l: Pick<TradingLeague, "marketFetchedAt" | "sources">, now: Date): string | null {
  const market = typeof l.marketFetchedAt === "string" ? ({ fetchedAt: l.marketFetchedAt } as MarketInputs) : null;
  return freshnessText({ market, sources: l.sources ?? [] }, now.getTime());
}

/**
 * FantasyCalc's values on trade cards (5.4: never shown, the reasons, the message, a Plan B and the Analyzer's "Details"
 * included) and each card's credit: "These numbers weigh each player's trade value." then its "Values: FantasyCalc" link,
 * when trade values are behind the numbers. `label` names a card in the details ("idea 3").
 */
export async function cardValueChecks(ctx: StepContext, step: string, label: (i: number) => string, league: TradingLeague | null): Promise<void> {
  const { page, report } = ctx;
  const cards = await page.run<CardText[]>(cleaning(ctx) + READ_CARD_TEXTS);
  if (!cards.length) {
    report.skip(step, "FantasyCalc's values on the cards: no card to read");
    return;
  }
  const which = cards.length === 1 ? "the card" : `the ${cards.length} cards`;
  const leaks = cards.flatMap((c, i) => valueLeaks(c.text).map((l) => `${label(i)}: ${l}`));
  report.check(step, leaks.length === 0, `no FantasyCalc value or value comparison on ${which} (reasons, messages and closed parts included)`, `${pl(leaks.length, "trade value")} shown: Offer Sheet never displays FantasyCalc's values (their condition 4)`, leaks);
  // Trade values are behind the numbers unless the saved inputs carry none (unknown: taken to be loaded, as the page does).
  if (league && !league.hasMarket) {
    report.skip(step, "the cards' FantasyCalc credit: this league's trade values didn't load, so the cards' numbers don't weigh them");
    return;
  }
  const problems = cards.map((c, i) => creditProblems(c.credit).map((p) => `${label(i)}: ${p}`));
  const wrong = problems.filter((p) => p.length).length;
  report.check(
    step,
    wrong === 0,
    `${cards.length === 1 ? "the card credits" : "every card credits"} FantasyCalc: “${VALUES_CREDIT}”, then its “Values: FantasyCalc” link (rel noopener, referrerpolicy origin)`,
    `${pl(wrong, "card")} without FantasyCalc's credit as it should read`,
    problems.flat(),
  );
}

/**
 * The tab's saved league as the prizes read it (inPage.ts READ_PRIZE_LEAGUE; Checkpoint 7c): its raw saved settings (null:
 * the defaults) and its snapshot's weeks, no names.
 */
export interface PrizeLeague {
  settings: unknown;
  snapshot: { settings: { regularSeasonWeeks: number[]; pointsOnly: boolean }; schedule: Array<{ week: number; weeks?: number[]; isPlayoff: boolean }> } | null;
}

/** Which top-N odds line saved settings call for (pure; tradeView.ts topPlacesOf on their reward, the prize periods aside). */
export function expectedTopPlaces(settings: unknown): 2 | 3 | null {
  return topPlacesOf(rewardWith(normalizeTradeSettings(settings), 1));
}

/**
 * Why saved settings call for no top-N odds line, in the check lines' words (pure): the answer chosen when it isn't "Several
 * prizes" ("“Only the champion” is chosen": a fresh browser's), else that the saved prizes pay neither 2nd nor 3rd place.
 */
export function noTopReason(settings: unknown): string {
  const s = normalizeTradeSettings(settings);
  return s.goal === "prizes" ? "the saved prizes pay no 2nd or 3rd place" : `“${GOAL_LABEL[s.goal]}” is chosen`;
}

/**
 * The split line the Settings page shows for `settings` on the league (pure; the app's own words: reward.ts rewardOf over the
 * league's prize periods, settingsView.ts prizeSplitText), null when the amounts add up to nothing (the warning shows then).
 */
export function expectedPrizeSplit(settings: TradeSettings, snapshot: PrizeLeague["snapshot"]): string | null {
  const league = (snapshot ?? { settings: { regularSeasonWeeks: [], pointsOnly: false }, schedule: [] }) as unknown as Pick<LeagueSnapshot, "settings" | "schedule">;
  const reward = rewardOf(settings, league);
  return reward.empty ? null : prizeSplitText(reward.shares, reward.periods);
}

async function readPrizeLeague(ctx: StepContext): Promise<PrizeLeague | null> {
  return ctx.page.run<PrizeLeague>(READ_PRIZE_LEAGUE).catch(() => null);
}

/**
 * Every card's odds lines, and a Plan B box's, read "Title odds", then the top-N line the tab's saved settings call for
 * ("Top 3 odds" or "Top 2 odds": expectedTopPlaces; none in a fresh browser, whose answer is "Only the champion"), then
 * "Playoff odds" (Checkpoint 7c; contracts.ts oddsLabelProblems). `label` names a card in the details ("idea 3"); `under`
 * opens each line with the setting it's read under (the Settings step's prizeOddsChecks: "under “Several prizes”").
 * Checkpoint 7c (planner reply to Checkpoint 7b, §7: their lines "in the same format as yours"): every card's partner's line
 * ("Helps them 24 · Their title odds …") names their odds the same way, "Their title odds", "Their top 3 odds", "Their playoff
 * odds"; a card without the line (none simulated) is passed over.
 */
export async function cardOddsChecks(ctx: StepContext, step: string, label: (i: number) => string, under = ""): Promise<void> {
  const { page, report } = ctx;
  const lead = under ? `${under}, ` : "";
  const cards = await page.run<string[][][]>(READ_CARD_ODDS);
  const lines = cards.flatMap((card, i) => card.map((labels, j) => ({ labels, where: j === 0 ? label(i) : `${label(i)}'s “If they won't move: try …”` })));
  if (!lines.length) {
    report.skip(step, `${lead}the odds lines: no card shows them`);
    return;
  }
  const saved = (await readPrizeLeague(ctx))?.settings ?? null;
  const places = expectedTopPlaces(saved);
  const problems = oddsLabelProblems(
    lines.map((l) => l.labels),
    places,
    (k) => lines[k]?.where ?? "",
  );
  const want = ["Title odds", ...(places ? [`Top ${places} odds`] : []), "Playoff odds"].join(" · ");
  report.check(
    step,
    problems.length === 0,
    `${lead}${pl(lines.length, "odds line")} read “${want}”${places ? "" : ` (${noTopReason(saved)})`}`,
    `${lead}${pl(problems.length, "odds line")} read otherwise than “${want}”`,
    problems,
  );
  // The partner's line on each card (Checkpoint 7c).
  const shown = await page.run<CardInfo[]>("return allCards();", { cards: true });
  const theirs = shown.flatMap((c, i) => (c.theirOdds ? [{ labels: c.theirOdds, where: label(i) }] : []));
  if (!theirs.length) {
    report.skip(step, `${lead}the partner's odds: no card shows a “Helps them” line`);
    return;
  }
  const wantTheirs = ["Their title odds", ...(places ? [`Their top ${places} odds`] : []), "Their playoff odds"].join(" · ");
  const theirProblems = oddsLabelProblems(
    theirs.map((t) => t.labels),
    places,
    (k) => theirs[k]?.where ?? "",
    "theirs",
  );
  report.check(
    step,
    theirProblems.length === 0,
    `${lead}${pl(theirs.length, "partner's line")} read “Helps them N · ${wantTheirs}”`,
    `${lead}${pl(theirProblems.length, "partner's line")} read otherwise than “Helps them N · ${wantTheirs}”`,
    theirProblems,
  );
}

/**
 * My odds on the League page carry a top-N chance exactly when the tab's saved settings call for one ("Your odds: 60%
 * playoffs · 30% top 3 · 10.5% title"; Checkpoint 7c; contracts.ts headlineTopProblems). `under` as cardOddsChecks'.
 */
export async function myOddsChecks(ctx: StepContext, step: string, under = ""): Promise<void> {
  const { page, report } = ctx;
  const lead = under ? `${under}, ` : "";
  const lines = await page.run<string[]>(READ_MY_ODDS);
  if (!lines.length) {
    report.skip(step, `${lead}your odds' top-N chance: no “Your odds:” line (no team picked, or no odds)`);
    return;
  }
  const saved = (await readPrizeLeague(ctx))?.settings ?? null;
  const places = expectedTopPlaces(saved);
  const problems = headlineTopProblems(lines, places);
  report.check(
    step,
    problems.length === 0,
    places ? `${lead}your odds carry your top-${places} chance: “${lines[0] ?? ""}”` : `${lead}your odds show no top-N chance (${noTopReason(saved)}): “${lines[0] ?? ""}”`,
    `${lead}your odds' top-N chance isn't as the saved settings call for`,
    problems,
  );
}

/** Every link to FantasyCalc on the page as it stands has FantasyCalc's attributes, the footer's among them (5.4). */
export async function fantasyCalcDomCheck(ctx: StepContext, step: string): Promise<void> {
  const links = await ctx.page.run<FantasyCalcLink[]>(READ_FANTASYCALC_LINKS);
  const issues = fantasyCalcLinkIssues(links, { requireFooter: true });
  ctx.report.check(step, issues.length === 0, `every link to FantasyCalc on the page (${links.length}, the footer's among them) has rel "noopener" and referrerpolicy "origin"`, `${pl(issues.length, "problem")} with the page's links to FantasyCalc`, issues);
}

/** The Trade Finder's warnings box (titled "Things to know", in plain words) and its whole page free of codes (§5.1). */
export async function finderNoticeChecks(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const r = await page.run<{ results: boolean; boxes: Array<{ title: string | null; text: string }>; page: string }>(cleaning(ctx) + READ_FINDER_NOTICES);
  if (r.boxes.length) {
    const titles = r.boxes.filter((b) => b.title !== "Things to know").map((b) => `a warnings box titled “${b.title ?? "(no title)"}”`);
    const leaks = r.boxes.flatMap((b) => noticeLeaks(b.text));
    report.check(step, titles.length + leaks.length === 0, "its warnings box is titled “Things to know” and speaks plainly: no code, path or stat ID", "its warnings box isn't as it should be", [...titles, ...leaks]);
  }
  const leaks = noticeLeaks(r.page);
  report.check(step, leaks.length === 0, "the Trade Finder shows no warning code, JSON path, stat ID or player-ID matching anywhere (closed parts and hover texts included)", "the Trade Finder shows internal text", leaks);
}

/** The Trade Finder's planner-worded "Best time to look:" lead (5.3). */
const BEST_TIME_LEAD = "Best time to look: Tuesday or Wednesday, after Monday night's game.";

interface FinderTiming {
  header: boolean;
  intro: number;
  best: string | null;
  bestAt: number;
  fresh: string | null;
  freshAt: number;
}

/** Which parts a freshness line has (pure): FantasyCalc's time, the projections' time. */
function freshnessParts(line: string): string {
  return [/^Trade values updated\b/.test(line) && "trade values", /\bProjections updated\b/.test(line) && "projections"].filter(Boolean).join(" and ") || "neither";
}

/**
 * The Trade Finder's two lines under its intro (5.3): the freshness line, whenever the saved inputs carry a time to say
 * (freshnessExpectation; with neither FantasyCalc's time nor the projections' there's nothing to say, a skip); "Best time
 * to look:" in season before the trade deadline (bestTimeExpectation). Their exact parts and words follow the league's
 * data: an info line when they differ from what the check works out (the build can be older than the source it reads).
 */
export async function finderTimingChecks(ctx: StepContext, step: string, league: TradingLeague | null): Promise<void> {
  const { page, report } = ctx;
  const t = await page.run<FinderTiming>(READ_FINDER_TIMING);
  const under = (at: number) => t.intro >= 0 && at > t.intro;
  // undefined: the saved league couldn't be read (a line is expected, as the page would say one with any time to give).
  const fresh = league ? freshnessExpectation(league, new Date()) : undefined;
  if (t.fresh === null && fresh === null) {
    report.skip(step, "the freshness line: this league's saved inputs carry neither FantasyCalc's time nor the projections', so there's nothing to say");
  } else {
    const shown = report.check(
      step,
      t.fresh !== null && freshnessLineOk(t.fresh) && under(t.freshAt),
      `the freshness line under the intro: “${t.fresh ?? ""}”`,
      t.fresh === null ? "no freshness line (“Trade values updated … · Projections updated ….”) under the intro" : !freshnessLineOk(t.fresh) ? `the freshness line reads “${t.fresh}”` : "the freshness line isn't under the intro",
    );
    if (shown && t.fresh !== null && typeof fresh === "string" && freshnessParts(t.fresh) !== freshnessParts(fresh))
      report.info(step, "the freshness line names other times than this league's saved inputs give", [`shown: ${t.fresh}`, `expected: ${fresh}`]);
  }
  if (!league) {
    report.skip(step, "“Best time to look:”: this tab's saved league couldn't be read");
    return;
  }
  const want = bestTimeExpectation(league, new Date());
  if (!want.inSeason) {
    if (t.best === null) report.ok(step, "out of season or past the trade deadline: no “Best time to look:” line");
    else report.info(step, "“Best time to look:” shows, though the check reads this league as out of season or past its trade deadline", [t.best]);
    return;
  }
  const shown = report.check(
    step,
    t.best !== null && t.best.startsWith(BEST_TIME_LEAD) && under(t.bestAt),
    `in season before the trade deadline, it says when to look: “${t.best ?? ""}”`,
    t.best === null ? "in season before the trade deadline, there's no “Best time to look:” line" : !t.best.startsWith(BEST_TIME_LEAD) ? `the “Best time to look:” line reads “${t.best}”` : "the “Best time to look:” line isn't under the intro",
  );
  if (shown && t.best !== want.text) report.info(step, "the “Best time to look:” line differs from what this league's review period gives", [`shown: ${t.best}`, `expected: ${want.text}`]);
}

/** The header's links on a phone (§6.2): the six (Waivers after League), in exactly two rows, each a 44 px tap target. */
export async function navRowsCheck(ctx: StepContext, step: string): Promise<void> {
  const r = await ctx.page.run<{ width: number; links: Array<{ href: string | null; text: string; top: number; bottom: number; width: number; height: number }> }>(READ_NAV_LINKS);
  const hrefs = r.links.map((l) => l.href ?? "");
  const same = hrefs.length === NAV_HREFS.length && NAV_HREFS.every((h, i) => hrefs[i] === h);
  const rows = rowCount(r.links);
  const small = r.links.filter((l) => l.height < 43.5 || l.width < 24);
  ctx.report.check(
    step,
    same && rows === 2 && small.length === 0,
    `at ${r.width} px the header's six links sit in two rows, each at least 44 px tall`,
    !same ? `at ${r.width} px the header's links go to ${hrefs.join(", ") || "nothing"} (expected ${NAV_HREFS.join(", ")})` : rows !== 2 ? `at ${r.width} px the header's links take ${pl(rows, "row")}, not 2` : `${pl(small.length, "header link")} under 44 px tall or 24 px wide`,
    r.links.map((l) => `${l.text} (${l.href ?? ""}): ${l.top}–${l.bottom} px, ${l.width} × ${l.height}`),
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Connect

export async function connectStep(ctx: StepContext): Promise<void> {
  const step = "Connect";
  const { page, report } = ctx;
  page.step = step;
  await page.navigate("/connect");
  await page.waitFor(`document.getElementById("espn-league")`, 30_000, "the league link box");
  await sleep(500);
  const first = await page.run<{ viewport: number; input: { bottom: number } | null; button: { bottom: number } | null; m: Measure }>(`
    const input = document.getElementById("espn-league");
    const button = [...document.querySelectorAll("button[type=submit]")].find((b) => txt(b).includes("Import"));
    return { viewport: innerHeight, input: input ? box(input) : null, button: button ? box(button) : null, m: measure() };
  `);
  report.check(
    step,
    !!first.input && !!first.button && first.input.bottom <= first.viewport && first.button.bottom <= first.viewport,
    `the league link box and the Import button are on the first screen (the button ends at ${first.button?.bottom ?? "?"} of ${first.viewport} px)`,
    first.input && first.button ? `the Import button ends at ${first.button.bottom} px, below the first screen (${first.viewport} px)` : "the league link box or the Import button is missing",
  );
  layoutChecks(ctx, step, first.m);
  await screenshot(ctx, "01-connect");

  // The public-link import: the id typed (React's setter, then the input event), the season when ESPN_SEASON names one.
  await page.run(`setInput(document.getElementById("espn-league"), ${JSON.stringify(ctx.leagueId)}); return true;`);
  if (ctx.season) {
    const picked = await page.run<boolean>(`
      const s = document.getElementById("espn-season");
      if (!s || ![...s.options].some((o) => o.value === ${JSON.stringify(ctx.season)})) return false;
      if (s.value !== ${JSON.stringify(ctx.season)}) setSelect(s, ${JSON.stringify(ctx.season)});
      return true;
    `);
    if (!picked) report.note(step, "season", "ESPN_SEASON isn't one of the Connect page's seasons: its default was used");
  }
  const recognized = await page.waitFor<boolean>(`[...document.querySelectorAll("span")].some((e) => /^League \\d+$/.test(txt(e)))`, 10_000, "the league id to be recognized").catch(() => false);
  if (!recognized) {
    report.fail(step, "the link box didn't recognize ESPN_LEAGUE_ID as a league id");
    ctx.stop = "the import couldn't start";
    return;
  }
  const started = Date.now();
  await page.click(`[...document.querySelectorAll("button[type=submit]")].find((b) => txt(b).includes("Import"))`, "the Import button");
  const outcome = await page
    .waitFor<string>(
      `location.pathname === "/import" && document.getElementById("my-team") ? "ok" : (() => { const e = [...document.querySelectorAll("[role=alert], .text-danger-fg")].map(txt).filter((t) => t.length > 3)[0]; return e ? "error: " + e : null; })()`,
      240_000,
      "the import",
      250,
    )
    .catch((err: unknown) => `error: ${err instanceof Error ? err.message : "the import didn't finish"}`);
  const took = seconds(Date.now() - started);
  report.note(step, "importSeconds", took);
  if (outcome !== "ok") {
    report.fail(step, `the import didn't work: ${outcome.replace(/^error: /, "")}`);
    ctx.stop = "the league wasn't imported";
    return;
  }
  report.ok(step, `imported the league through its public link in ${took} s`);

  // The imported league's names (the league store's copy of the tab's league): from here on, every line printed and
  // every screenshot uses placeholders.
  const names = await page.run<LeagueNames | null>(`return namesOf(await savedImport());`);
  if (!names) {
    report.fail(step, "the imported league isn't saved in this browser as this tab's league (the league store, IndexedDB offersheet)");
    ctx.stop = "the import wasn't stored";
    return;
  }
  ctx.names = names;
  ctx.onNames(names);
  report.note(step, "teams", names.teams.length);

  // Which path read the league (Part B, track BF): with no ESPN cookies connected, this browser reads a public league from
  // ESPN itself and sends it up; the saved import says who read it (readBy), and the step saw the browser's own reads.
  const saved = await page.run<{ readBy: string | null; signed: boolean } | null>(
    `const s = await savedImport(); return s && s.response ? { readBy: s.response.readBy ?? null, signed: Boolean(s.response.signed) } : null;`,
  );
  const espnReads = page.eventsOf(step).filter((e) => e.kind === "platform read" && e.text.includes("lm-api-reads.fantasy.espn.com")).length;
  const path = readPathOf(saved?.readBy ?? null, espnReads);
  report.note(step, "readBy", path.readBy);
  report.note(step, "browserReadsFromEspn", espnReads);
  report.note(step, "signedImport", saved?.signed ?? false);
  report.check(step, path.readBy === "browser", path.text, path.text);
}

/**
 * Which path read the league (pure; the Connect step): "browser" when the saved import says the browser read it and the
 * browser was seen reading ESPN; "server" when the server did (after the browser tried, when it was seen trying: a
 * fallback); "unknown" for an import that doesn't say (one saved before browser reading). With the words for the report.
 */
export function readPathOf(readBy: string | null, platformReads: number): { readBy: "browser" | "server" | "unknown"; text: string } {
  if (readBy === "browser" && platformReads > 0) return { readBy: "browser", text: `read the league in this browser, straight from ESPN (${pl(platformReads, "request")}), and sent it up (track BF)` };
  if (readBy === "browser") return { readBy: "unknown", text: "the import says this browser read the league, but no read from ESPN was seen" };
  if (readBy === "server")
    return {
      readBy: "server",
      text: platformReads > 0 ? `Offer Sheet's server read the league after this browser tried (${pl(platformReads, "request")} to ESPN): the browser path fell back` : "Offer Sheet's server read the league: the browser path didn't run",
    };
  return { readBy: "unknown", text: "the saved import doesn't say who read the league" };
}

// ---------------------------------------------------------------------------------------------
// 2. Import Report

export async function importReportStep(ctx: StepContext): Promise<void> {
  const step = "Import Report";
  const { page, report, args } = ctx;
  page.step = step;
  await page.waitFor(`document.getElementById("my-team")`, 30_000, "the Import Report");
  await sleep(400);
  layoutChecks(ctx, step, await measurePage(ctx));
  // Who read the league, in the report's data card (Part B, track BF: "League data read by").
  const readBy = await page.run<string | null>(`const dt = [...document.querySelectorAll("dt")].find((d) => txt(d) === "League data read by"); return dt && dt.nextElementSibling ? txt(dt.nextElementSibling) : null;`);
  report.check(step, readBy !== null, `the data card says who read the league: ${readBy ?? ""}`, `the data card doesn't say who read the league ("League data read by")`);
  const choice = await page.run<{ value: string; options: string[] }>(`
    const sel = document.getElementById("my-team");
    return { value: sel.value, options: [...sel.options].map((o) => o.value).filter(Boolean) };
  `);
  ctx.myTeam = choice.value || null;
  if (args.team) {
    if (!choice.options.includes(args.team)) {
      report.fail(step, `team ${args.team} isn't in this league (its team ids: ${choice.options.join(", ")})`);
    } else {
      await page.run(`setSelect(document.getElementById("my-team"), ${JSON.stringify(args.team)}); return true;`);
      const kept = await page.waitFor<boolean>(`document.getElementById("my-team").value === ${JSON.stringify(args.team)}`, 10_000, "the team pick").catch(() => false);
      await sleep(400);
      if (report.check(step, kept, `picked team ${args.team} as yours`, `picking team ${args.team} didn't stick`)) ctx.myTeam = args.team;
    }
  } else if (ctx.myTeam) {
    report.ok(step, `kept the Import Report's choice: team ${ctx.myTeam}`);
  } else {
    report.skip(step, "no team picked (pass --team <id>): the Trade Finder, card and Analyzer checks need one");
  }
  report.note(step, "myTeam", ctx.myTeam);
  // Phase 7b (§5.1): what the report says before the League page has loaded the projections (the Notices step reads it
  // again after, with Parker's own expectations).
  await settle(page);
  await importNoticeChecks(ctx, step, { parkers: false });
  await screenshot(ctx, "02-import-report");
}

// ---------------------------------------------------------------------------------------------
// 3. League

const LEAGUE_READY = `(() => { if (location.pathname !== "/league") return null; const none = noImport(); if (none) return "error: the page says " + none; const l = statusLines(); if (l.some((t) => t === "Your League page is ready." || t === "The numbers are up to date.")) return "ready"; const a = alerts(); return a.length ? "error: " + a[0] : null; })()`;

export async function leagueStep(ctx: StepContext): Promise<void> {
  const step = "League";
  const { page, report } = ctx;
  page.step = step;
  const started = Date.now();
  await page.click(`navLink("/league")`, "the nav's League link");
  const state = await page.waitFor<string>(LEAGUE_READY, 400_000, "the League page", 250).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't load"}`);
  const took = seconds(Date.now() - started);
  report.note(step, "readySeconds", took);
  if (!report.check(step, state === "ready", `built the League page in ${took} s`, `the League page didn't load: ${state.replace(/^error: /, "")}`)) return;
  ctx.leagueReady = true;
  await sleep(600);
  layoutChecks(ctx, step, await measurePage(ctx));
  await narrowHeaderCheck(ctx, step);
  await navRowsCheck(ctx, step);
  // Checkpoint 7h: the page opens with its heatmap, Best available and my roster closed; the step opens them (and every free
  // agent) with taps before it reads them, and closes them again at its end (closeLeagueSections).
  const opened = await openLeagueSections(ctx, step);

  if (!ctx.myTeam) {
    report.skip(step, `"Harder to get" on your own players: no team picked`);
  } else {
    const tags = await page.run<{ marked: boolean; roster: number; row: number; youCanGive: number; others: number; myRowTables: number; tablesWithSeveral: number; partnerCards: number; cardsWithoutGive: number }>(`
      const rosters = [...document.querySelectorAll("details")].filter((d) => d.querySelector("summary") && d.querySelector("table"));
      const myRosters = rosters.filter((d) => hasYouBadge(d.querySelector("summary")));
      const myRows = [...document.querySelectorAll("tbody tr")].filter((tr) => { const th = tr.querySelector("th"); return th && hasYouBadge(th); });
      const giveLines = [...document.querySelectorAll("p")].filter((p) => txt(p).startsWith("You could give"));
      // Partner cards: the list items that link to the Trade Finder for their team.
      const partnerCards = [...new Set([...document.querySelectorAll("a[href^='/trades?partner=']")].map((a) => a.closest("li")).filter(Boolean))];
      const rowsPerTable = new Map();
      for (const tr of myRows) { const t = tr.closest("table"); rowsPerTable.set(t, (rowsPerTable.get(t) || 0) + 1); }
      const count = (els) => els.reduce((n, e) => n + tagLeaves(e).length, 0);
      const mine = count(myRosters) + count(myRows) + count(giveLines);
      return {
        marked: myRosters.length > 0,
        roster: count(myRosters),
        row: count(myRows),
        youCanGive: count(giveLines),
        others: tagLeaves(document).length - mine,
        myRowTables: rowsPerTable.size,
        tablesWithSeveral: [...rowsPerTable.values()].filter((n) => n > 1).length,
        partnerCards: partnerCards.length,
        cardsWithoutGive: partnerCards.filter((li) => ![...li.querySelectorAll("p")].some((p) => txt(p).startsWith("You could give"))).length,
      };
    `);
    report.check(step, tags.marked, "your team is marked (its roster opens with a You badge)", "no roster carries the You badge: your team isn't marked");
    // Where the tags are counted must be found, or the next check would pass with nothing to count.
    const anchors: string[] = [];
    if (tags.myRowTables === 0) anchors.push("no table row is marked as your team (a You badge in the row's heading cell)");
    if (tags.tablesWithSeveral) anchors.push(`${pl(tags.tablesWithSeveral, "table")} mark more than one row as your team`);
    if (tags.cardsWithoutGive) anchors.push(`${tags.cardsWithoutGive} of ${pl(tags.partnerCards, "partner card")} have no "You could give" line`);
    report.check(
      step,
      anchors.length === 0,
      `found your rows (${pl(tags.myRowTables, "table")}) and every partner card's "You could give" line (${pl(tags.partnerCards, "card")})`,
      `the places your players show couldn't all be found, so the tag check below can't be trusted`,
      anchors,
    );
    const mine = tags.roster + tags.row + tags.youCanGive;
    report.check(
      step,
      mine === 0,
      `no "Harder to get" tag on your own players (${pl(tags.others, "tag")} on other teams' players)`,
      `"Harder to get" shows on your own players ${pl(mine, "time")}`,
      [`your roster: ${tags.roster}`, `your rows in the tables: ${tags.row}`, `"You could give" in the partner cards: ${tags.youCanGive}`],
    );
  }
  await screenshot(ctx, "03-league");
  // Phase 7b: FantasyCalc's values never shown (5.4; every breakdown opened, read, closed again: after the screenshot),
  // the notices (§5.1), and the links back to FantasyCalc.
  await leagueValueChecks(ctx, step);
  await leagueNoticeChecks(ctx, step, { parkers: parkersLeague(ctx.args) });
  await fantasyCalcDomCheck(ctx, step);
  // Checkpoint 7c: my odds carry a top-N chance exactly when the saved prizes call for one.
  await myOddsChecks(ctx, step);
  // Checkpoint 7f: my roster card's "Returns from IR" reads as the cards word a release.
  await releaseLineChecks(ctx, step, "your roster's returns from IR", "league");
  await closeLeagueSections(ctx, step, opened);
}

/** What the League step opened with its taps (openLeagueSections), each a tap expression and its words, in the order tapped. */
type LeagueOpened = Array<{ expr: string; what: string }>;

/**
 * The League page's parts closed by default (Checkpoint 7h, the integration's track "league": toward "about 8 screens"): as the
 * page opens, the positional-strength heatmap and Best available are closed under their headings (DisclosureCard.tsx: each
 * heading's 44 px button) and my roster card is closed like the others (contracts.ts leagueSectionsProblems "closed"), and the
 * page's height is noted in phone screens (`screens`). Then the step opens what it reads with trusted taps, as a user would:
 * each card's heading, my roster's summary and Best available's "Show all" (so its scans read every free agent, not only the
 * best few a position), each tap keeping focus on its control; holds the result to the "open" contract and measures the layout
 * again with them open (their tap targets and widths). Returns what it opened, for closeLeagueSections.
 */
export async function openLeagueSections(ctx: StepContext, step: string): Promise<LeagueOpened> {
  const { page, report } = ctx;
  const mine = !!ctx.myTeam;
  const before = await page.run<LeagueSectionsRead>(READ_LEAGUE_SECTIONS);
  const screens = Math.round((before.height / PHONE.height) * 10) / 10;
  report.note(step, "screens", screens);
  const closedProblems = leagueSectionsProblems(before, "closed", mine);
  report.check(
    step,
    closedProblems.length === 0,
    `the page opens with “${LEAGUE_DISCLOSURES.heatmap}” and “${LEAGUE_DISCLOSURES["free-agents"]}” closed under their headings (44 px controls)${before.myRoster ? " and your roster card closed" : ""}: ${screens} phone screens of content`,
    "the League page doesn't open with its parts closed as it should",
    closedProblems,
  );
  const opened: LeagueOpened = [];
  const issues: string[] = [];
  // `button`: the control is ours (a disclosure button), so focus must stay on it; a <summary>'s focus is the browser's.
  const tap = async (expr: string, what: string, isOpen: string, button = true): Promise<boolean> => {
    try {
      await page.click(expr, what);
      await page.waitFor<boolean>(isOpen, 5_000, `${what} to open`);
      opened.push({ expr, what });
      if (button && !(await page.run<boolean>(`return document.activeElement === ${expr};`))) issues.push(`focus left ${what} when it opened`);
      return true;
    } catch (err) {
      issues.push(`${what}: ${err instanceof Error ? err.message : "it didn't open"}`);
      return false;
    }
  };
  for (const [key, heading] of Object.entries(LEAGUE_DISCLOSURES)) {
    const d = before.disclosures.find((x) => x.key === key);
    if (!d || d.expanded) continue;
    const expr = leagueDisclosure(key);
    await tap(expr, `“${heading}”'s heading`, `${expr}.getAttribute("aria-expanded") === "true"`);
  }
  if (before.myRoster && !before.myRoster.open) await tap(MY_ROSTER_SUMMARY, "your roster card's summary", `${MY_ROSTER_SUMMARY}.parentElement.open`, false);
  const all = await page.run<boolean | null>(`const b = ${FREE_AGENTS_ALL}; return b ? b.getAttribute("aria-expanded") === "true" : null;`);
  if (all === false) await tap(FREE_AGENTS_ALL, "Best available's “Show all”", `${FREE_AGENTS_ALL}.getAttribute("aria-expanded") === "true"`);
  await sleep(300);
  const after = await page.run<LeagueSectionsRead>(READ_LEAGUE_SECTIONS);
  const problems = [...leagueSectionsProblems(after, "open", mine), ...issues];
  report.check(
    step,
    problems.length === 0,
    `opened with taps what the step reads (${opened.map((o) => o.what).join(", ") || "nothing closed"}), focus kept on each button: ${Math.round((after.height / PHONE.height) * 10) / 10} phone screens with them open`,
    "couldn't open what the League step reads",
    problems,
  );
  layoutChecks(ctx, step, await measurePage(ctx), "the page", "with those open: ");
  return opened;
}

/**
 * Closes again what openLeagueSections opened (trusted taps, the last first), so the page is as it opens for the steps after
 * this one and the clutter-3 shot (taken at the Waivers step's end: "nothing unfolded"); holds it to the "closed" contract.
 */
export async function closeLeagueSections(ctx: StepContext, step: string, opened: LeagueOpened): Promise<void> {
  const { page, report } = ctx;
  if (!opened.length) return;
  const issues: string[] = [];
  for (const o of [...opened].reverse()) {
    try {
      await page.click(o.expr, o.what);
    } catch (err) {
      issues.push(`${o.what}: ${err instanceof Error ? err.message : "it couldn't be tapped"}`);
    }
  }
  await sleep(300);
  const read = await page.run<LeagueSectionsRead>(READ_LEAGUE_SECTIONS);
  // Best available's "Show all" is closed again with its card (its body hidden), so it reads collapsed too.
  const problems = [...leagueSectionsProblems(read, "closed", !!ctx.myTeam), ...issues];
  report.check(step, problems.length === 0, `closed again what it opened (${opened.length}), so the page is as it opens`, "couldn't close again what the League step opened", problems);
}

/**
 * Every line about a release at an IR return on the page as it stands (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4:
 * "keep the rule, but the card must say why"; inPage.ts READ_RELEASE_LINES: the lists of roster moves alone, the review of
 * Checkpoint 7f, PIERCE-1) reads as the cards word it (contracts.ts releaseLineProblems): a reason in the planner's shape
 * (since Checkpoint 7g "From week 7 on, he and … add about the same to your starting lineup, …", from the line's own return
 * week), never after "instead of dropping someone else", its lock where it is (`page`), and a release made with or without
 * the trade named in the line of moves made either way. A skip when the page shows none (no IR player of mine, or room for
 * every return).
 */
async function releaseLineChecks(ctx: StepContext, step: string, where: string, on: "league" | "trade"): Promise<void> {
  const { page, report } = ctx;
  const lines = await page.run<string[]>(cleaning(ctx) + READ_RELEASE_LINES);
  if (!lines.length) {
    report.skip(step, `${where}: no release at an IR return to read`);
    return;
  }
  const reasons = lines.filter((l) => l.includes(RELEASE_REASON_MARK)).length;
  const either = lines.filter((l) => l.startsWith("Assumed with or without this trade")).length;
  const problems = releaseLineProblems(lines, on);
  report.check(
    step,
    problems.length === 0,
    `${where}: ${pl(lines.length, "line")} about a release at an IR return read as the cards word them (${reasons} with the near-tie rule's reason, ${either} naming one made either way)`,
    `${where}: a line about a release at an IR return doesn't read as it should`,
    problems,
  );
}

// ---------------------------------------------------------------------------------------------
// 3b. Notices (Phase 7b)

/**
 * The Import Report again, once the League page has loaded the league's projections (the notices read them while they're
 * fresh): the same contract as the Import Report step's (§5.1), and Parker's league as the planner expects it (with
 * --team): no notice, and the quiet line for its two rare uncounted rules.
 */
export async function noticesStep(ctx: StepContext): Promise<void> {
  const step = "Notices";
  const { page, report } = ctx;
  page.step = step;
  await page.click(`navLink("/import")`, "the nav's Report link");
  const ready = await page.waitFor<boolean>(`location.pathname === "/import" && !!document.getElementById("my-team")`, 30_000, "the Import Report").catch(() => false);
  if (!report.check(step, ready, `the Import Report opened again${ctx.leagueReady ? ", with the projections the League page loaded" : ""}`, "the Import Report didn't open again")) return;
  await settle(page);
  if (!parkersLeague(ctx.args)) report.skip(step, "Parker's own expectations (no notices, the quiet scoring line): they apply with --team, on his league");
  await importNoticeChecks(ctx, step, { parkers: parkersLeague(ctx.args) });
}

/** The narrowest phone the header's first row is checked at (review PG-4): a 320 px screen, or a larger one at its biggest display size. */
export const NARROW_PHONE_WIDTH = 320;

/** Whether two boxes share a row (pure): they overlap from top to bottom. */
export function sameRow(a: { top: number; bottom: number }, b: { top: number; bottom: number }): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

/**
 * The header's first row on a NARROW_PHONE_WIDTH phone (review PG-4): with a league saved, the league switcher sits on the
 * row of the logo and the Beta pill, so the header's rows don't move when it appears after the store loads. The phone's
 * own width is put back afterwards, whatever happened.
 */
export async function narrowHeaderCheck(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  await page.setWidth(NARROW_PHONE_WIDTH);
  try {
    await sleep(400);
    const r = await page.run<{ width: number; home: { top: number; bottom: number } | null; pill: { top: number; bottom: number } | null; switcher: { top: number; bottom: number } | null }>(`
      const row = document.querySelector("header > div");
      const home = row && row.querySelector("a[href='/']");
      const pill = row && [...row.querySelectorAll("span")].find((s) => txt(s) === "Beta");
      const sw = row && row.querySelector("[data-league-switcher]");
      return { width: innerWidth, home: home ? box(home) : null, pill: pill ? box(pill) : null, switcher: sw ? box(sw) : null };
    `);
    if (!r.home || !r.pill || !r.switcher) {
      const missing = [!r.home && "the logo's home link", !r.pill && "the Beta pill", !r.switcher && "the league switcher"].filter(Boolean).join(", ");
      report.fail(step, `at ${r.width} px the header is missing ${missing}`);
      return;
    }
    report.check(
      step,
      sameRow(r.home, r.pill) && sameRow(r.home, r.switcher),
      `at ${r.width} px the logo, the Beta pill and the league switcher share the header's first row`,
      `at ${r.width} px the header's first row breaks: the logo at ${r.home.top}–${r.home.bottom} px, the pill at ${r.pill.top}–${r.pill.bottom}, the switcher at ${r.switcher.top}–${r.switcher.bottom}`,
    );
  } finally {
    await page.setWidth();
    await sleep(400);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Trade Finder

/**
 * The Trade Finder's status line once its ideas show (tradeView.ts buildFinderView statusText), in every sort and every empty
 * state: "Found 25 trade ideas.", since Checkpoint 7c's "Helps both" sort (planner reply to Checkpoint 7b, §7) also "Found 4
 * trade ideas that help both teams." and "No trades help both teams right now.", and the "No trade ideas …" titles; never a
 * searching, re-filtering or stopped search's. A test runs it on every status the view can show.
 */
export const FINDER_DONE_STATUS = /^(?:Found \d+ trade ideas?\b|No trade(?:s| ideas)\b)/;

/** The Trade Finder's state for a wait (an expression for the page): "done" once its ideas show (FINDER_DONE_STATUS), "error: …", else null. */
export const FINDER_DONE = `(() => { if (location.pathname !== "/trades") return null; const none = noImport(); if (none) return "error: the page says " + none; const l = statusLines(); if (l.some((t) => ${FINDER_DONE_STATUS.toString()}.test(t))) return "done"; const a = alerts(); return a.length ? "error: " + a[0] : null; })()`;

interface EngineAnswer {
  t: number;
  type: string;
  timings?: Record<string, number> | null;
  counts?: Record<string, number> | null;
  shown?: number | null;
}

/** The cards without a player under "You give" or "You get" (pure): every trade idea gives and gets someone. */
export function sidelessCards(cards: ReadonlyArray<Pick<CardInfo, "give" | "get">>): string[] {
  return cards.flatMap((c, i) => (c.give.length && c.get.length ? [] : [`idea ${i + 1}: ${c.give.length} under "You give", ${c.get.length} under "You get"`]));
}

/**
 * The places a sort leaves out of order (pure; rank.ts sortTrades): each card's number for that sort, highest first.
 * Chance they accept orders by the chance it goes through (P_complete) when the card shows one, else by the big
 * number, among the ideas that help (Helps you above 0; the others follow in their own order). "Helps both" (Checkpoint 7c,
 * planner reply to Checkpoint 7b, §7: "sorted by Helps you, highest first") orders its list by Helps you; whether each of
 * its cards helps both teams is contracts.ts helpsBothListProblems'.
 */
export function sortInversions(label: string, cards: ReadonlyArray<Pick<CardInfo, "helps" | "accept" | "acceptThrough" | "overall">>, sort: "helps" | "accept" | "overall" | "helpsBoth"): string[] {
  // "<5%" (an estimate under 5%, Phase 4c) sorts just under 5%.
  const num = (v: string | null) => (v === null || v === "—" ? -1 : v.trim().startsWith("<") ? parseFloat(v.replace(/[<%]/g, "")) - 0.1 : parseFloat(v.replace("%", "")));
  const shown = cards.map((c, i) => ({ i, value: sort === "accept" ? (c.acceptThrough ?? c.accept) : sort === "helpsBoth" ? c.helps : c[sort], helps: num(c.helps) }));
  const ordered = sort === "accept" ? shown.filter((c) => c.helps > 0) : shown;
  const out: string[] = [];
  for (let k = 1; k < ordered.length; k++) {
    const a = ordered[k - 1] as (typeof shown)[number];
    const b = ordered[k] as (typeof shown)[number];
    if (num(b.value) > num(a.value)) out.push(`${label}: idea ${a.i + 1} shows ${a.value}, idea ${b.i + 1} shows ${b.value}`);
  }
  return out;
}

export async function finderStep(ctx: StepContext): Promise<void> {
  const step = "Trade Finder";
  const { page, report, args } = ctx;
  page.step = step;
  const from = await mark(page);
  const started = Date.now();
  await page.click(`navLink("/trades")`, "the nav's Trades link");

  if (!ctx.myTeam) {
    const asks = await page
      .waitFor<string>(`location.pathname === "/trades" && (noImport() ? "no import" : txt(document.querySelector("main") || document.body).includes("Pick your team on the Import Report to see trade ideas.") ? "asks" : null)`, 120_000, "the Trade Finder")
      .catch(() => "no answer");
    report.check(step, asks === "asks", "with no team picked, it asks you to pick yours first", asks === "no import" ? "the Trade Finder says no league is imported" : "with no team picked, the Trade Finder doesn't ask for one");
    layoutChecks(ctx, step, await measurePage(ctx));
    report.skip(step, "the trade search: no team picked");
    await screenshot(ctx, "04-trade-finder");
    return;
  }

  const state = await page.waitFor<string>(FINDER_DONE, 300_000, "the trade search", 50).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
  const wall = seconds(Date.now() - started);
  if (!report.check(step, state === "done", "the trade search finished", `the trade search didn't finish: ${state.replace(/^error: /, "")}`)) return;
  await sleep(500);

  const timeline = await page.run<{ firstProgress: number | null; done: number | null; engine: EngineAnswer[]; longtasks: number[]; status: string }>(`
    const ev = eventsSince(${from}).filter((e) => e.path.startsWith("/trades"));
    const pb = ev.find((e) => e.pb !== null);
    const done = ev.find((e) => e.status.split(" | ").some((t) => ${FINDER_DONE_STATUS.toString()}.test(t)));
    return { firstProgress: pb ? pb.t : null, done: done ? done.t : null, engine: engineSince(${from}), longtasks: longtasksSince(${from}), status: statusLines().find((t) => ${FINDER_DONE_STATUS.toString()}.test(t)) || "" };
  `);
  const answer = timeline.engine.filter((e) => e.type === "trades").at(-1);
  const searchSeconds = timeline.firstProgress !== null && timeline.done !== null ? seconds(timeline.done - timeline.firstProgress) : null;
  report.note(step, "wallSeconds", wall);
  report.note(step, "searchSeconds", searchSeconds);
  if (answer?.timings) report.note(step, "engineMs", Object.fromEntries(Object.entries(answer.timings).map(([k, v]) => [k, Math.round(v)])));
  if (answer?.counts) report.note(step, "counts", answer.counts);
  report.note(step, "longestMainThreadTaskMs", timeline.longtasks.length ? Math.max(...timeline.longtasks) : 0);
  const shownSearch = searchSeconds ?? wall;
  report.check(
    step,
    shownSearch <= args.maxSearchSeconds,
    `a full search took ${shownSearch} s in the production worker (target ${args.maxSearchSeconds} s; ${wall} s from the tap)`,
    `a full search took ${shownSearch} s, over the ${args.maxSearchSeconds} s target`,
  );

  const cards = await page.run<CardInfo[]>("return allCards();", { cards: true });
  report.note(step, "ideas", cards.length);
  report.ok(step, `${timeline.status || "done"} (${pl(cards.length, "card")})`);
  if (cards.length) {
    const missing = cards.map((c, i) => (c.helps && c.accept && c.overall ? null : `idea ${i + 1}: ${c.helps ?? "?"} · ${c.accept ?? "?"} · ${c.overall ?? "?"}`)).filter((x): x is string => !!x);
    report.check(step, missing.length === 0, "every idea shows Helps you, Chance they accept and Overall", `${pl(missing.length, "idea")} lack one of the three numbers`, missing);
    // Both sides, under their headings: the tag check below counts what's under "You give".
    const sideless = sidelessCards(cards);
    report.check(step, sideless.length === 0, `every idea shows what you give and what you get`, `${pl(sideless.length, "idea")} lack a "You give" or "You get" player`, sideless);
    const tagged = cards.map((c, i) => (c.tagsOnMySide ? `idea ${i + 1}: ${c.give.map((g) => g.name).join(" + ")}` : null)).filter((x): x is string => !!x);
    const theirs = cards.reduce((n, c) => n + c.get.filter((g) => g.tagged).length, 0);
    report.check(step, tagged.length === 0, `no "Harder to get" tag on a player you'd give (${pl(theirs, "tag")} on players you'd get)`, `"Harder to get" shows on a player you'd give in ${pl(tagged.length, "idea")}`, tagged);
    ctx.firstCard = cards[0] ?? null;
    report.note(step, "top", cards.slice(0, 3).map((c) => `${c.heading}: ${c.give.map((g) => g.name).join(" + ")} for ${c.get.map((g) => g.name + (g.tagged ? " (Harder to get)" : "")).join(" + ")} = ${c.helps} · ${c.accept} · ${c.overall}`));
  }
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "04-trade-finder");
  // Phase 7b: FantasyCalc's values never on a card, each card's credit (5.4), the warnings (§5.1), the links back to
  // FantasyCalc, and the lines under the intro (5.3).
  const league = await readTradingLeague(ctx);
  if (cards.length) await cardValueChecks(ctx, step, (i) => `idea ${i + 1}`, league);
  // Checkpoint 7c: the odds lines, with the top-N line exactly when the saved prizes call for one.
  if (cards.length) await cardOddsChecks(ctx, step, (i) => `idea ${i + 1}`);
  await finderNoticeChecks(ctx, step);
  await fantasyCalcDomCheck(ctx, step);
  await finderTimingChecks(ctx, step, league);
}

// ---------------------------------------------------------------------------------------------
// 5. A trade card's buttons

/**
 * The sorts the card step tries, in this order (Checkpoint 7c's "Helps both" among them, planner reply to Checkpoint 7b, §7),
 * Overall last: the page is left in its default order, which the later steps' remembered Finder shows.
 */
export const SORTS = [
  { value: "helps", label: "Helps you" },
  { value: "accept", label: "Chance they accept" },
  { value: "helpsBoth", label: "Helps both" },
  { value: "overall", label: "Overall" },
] as const;

/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2, "Now or after this week"): on the Trade Finder, once the worker's
 * numbers are all in (the list's data-now-or-later stops reading "pending"), and on the Analyzer's card, every card's line
 * reads "Helps you 37 now · 41 if done after this week's games.", starts from its own Helps you, shows only when the two
 * differ by more than config.explain.nowOrLaterMin, and carries the planner's words as its tooltip and among its facts
 * (contracts.ts nowOrLaterProblems). How many show it is noted ("nowOrLater").
 */
export async function nowOrLaterChecks(ctx: StepContext, step: string, where: "finder" | "analyzer"): Promise<void> {
  const { page, report } = ctx;
  if (where === "finder") {
    const state = await page
      .waitFor<string>(`(() => { const v = document.querySelector("ol[data-now-or-later]"); if (!v) return "none"; const s = v.getAttribute("data-now-or-later"); return s === "pending" ? null : s; })()`, 120_000, "the cards' later lines", 100)
      .catch(() => "pending");
    if (state === "pending") {
      report.fail(step, "the cards' “Helps you … if done after this week's games” numbers didn't all arrive in 2 minutes");
      return;
    }
  }
  const cards = await page.run<NowOrLaterRead[]>(where === "finder" ? "return allNowOrLater();" : `const a = document.querySelector("article"); return a ? [nowOrLaterOf(a)] : [];`, { cards: true });
  const shown = cards.filter((c) => c.line !== null).length;
  if (where === "finder") report.note(step, "nowOrLater", shown);
  const problems = nowOrLaterProblems(cards, { min: config.explain.nowOrLaterMin, title: NOW_OR_LATER_TITLE }, (i) => (where === "finder" ? `idea ${i + 1}` : "the Analyzer's card"));
  report.check(
    step,
    problems.length === 0,
    where === "finder"
      ? `“Helps you … now · … if done after this week's games.” shows on ${shown} of ${pl(cards.length, "card")}, each from its own Helps you, more than ${config.explain.nowOrLaterMin} apart, its tooltip's words under it`
      : `the Analyzer's card ${shown ? "shows" : "doesn't need"} the “… if done after this week's games” line${shown ? ", from its own Helps you, its tooltip's words under it" : ""}`,
    "a card's “… if done after this week's games” line doesn't read as it should",
    problems,
  );
}

/**
 * Opens one of a card's two controls (Checkpoint 7h; planner reply to Checkpoint 7g, §1: cards closed by default, "Everything else
 * goes behind one "Details" control … "How to offer it" stays a separate control"; TradeCard.tsx: 44 px disclosure buttons) with a
 * trusted tap, unless it's open already (a second tap would close it). `card` is an expression for the card's <article>.
 */
export async function openCardPanel(page: PageSession, card: string, label: "Details" | "How to offer it"): Promise<void> {
  const open = await page.run<boolean>(`return panelOpen(${card}, ${JSON.stringify(label)});`, { cards: true });
  if (!open) await page.click(`cardDisclosure(${card}, ${JSON.stringify(label)})`, `the card's “${label}”`);
  await page.waitFor<boolean>(`panelOpen(${card}, ${JSON.stringify(label)})`, 5_000, `the card's “${label}” to open`);
}

export async function cardStep(ctx: StepContext): Promise<void> {
  const step = "Trade card";
  const { page, report } = ctx;
  page.step = step;
  if (!ctx.firstCard) {
    report.skip(step, ctx.myTeam ? "no trade idea to try the buttons on" : "no team picked");
    return;
  }
  // Checkpoint 7e (item 4.2): the cards' "now or after this week" lines, once they're all in, in the default sort.
  await nowOrLaterChecks(ctx, step, "finder");
  // Checkpoint 7g (planner reply to Checkpoint 7f, item 5): the clutter check's first screenshot, the whole Trade Finder before
  // anything on a card is pressed or opened (shots.ts; nothing with --no-shots).
  await finderShot(ctx, step);

  // The sorts: each reorders the ideas from the highest down (sortInversions), and none starts a new search. Checkpoint 7c
  // (planner reply to Checkpoint 7b, §7): in every sort the "Helps both" tag shows on exactly the cards that help both teams
  // as printed (since Checkpoint 7d, planner reply to Checkpoint 7c, answer 5: Helps you and Helps them each at least
  // config.benefit.helpsThemMin), and the "Helps both" sort shows only those, by Helps you, its status line saying how many.
  // Checkpoint 7d (answer 3): in every sort a card shows the partner's line exactly when it's tagged, and never in an "If they
  // say no, try:" box (finderPartnerLineProblems).
  const from = await mark(page);
  const inversions: string[] = [];
  const min = config.benefit.helpsThemMin;
  const tagProblems = new Set<string>();
  const lineProblems = new Set<string>();
  let lines = 0;
  let both: { cards: CardInfo[]; status: string } | null = null;
  for (const sort of SORTS) {
    const shown = await page.run<{ cards: CardInfo[]; status: string }>(
      `setSelect(document.getElementById("finder-sort"), ${JSON.stringify(sort.value)}); await sleep(400); return { cards: allCards(), status: statusLines().find((t) => ${FINDER_DONE_STATUS.toString()}.test(t)) || "" };`,
      { cards: true },
    );
    inversions.push(...sortInversions(sort.label, shown.cards, sort.value));
    for (const p of helpsBothTagProblems(shown.cards, min, (i) => `${sort.label}: idea ${i + 1}`)) tagProblems.add(p);
    for (const p of finderPartnerLineProblems(shown.cards, (i) => `${sort.label}: idea ${i + 1}`)) lineProblems.add(p);
    lines += shown.cards.filter((c) => c.helpsThem !== null).length;
    if (sort.value === "helpsBoth") both = shown;
  }
  const searched = await page.run<boolean>(`return eventsSince(${from}).some((e) => e.pb !== null);`);
  report.check(step, inversions.length === 0 && !searched, `the ${pl(SORTS.length, "sort")} reorder the ideas, highest first, without searching again`, searched ? "changing the sort started a new search" : "a sort leaves the ideas out of order", inversions);
  if (both) {
    const problems = [...helpsBothListProblems(both.cards, min), ...(helpsBothStatusOk(both.status, both.cards.length) ? [] : [`its status line reads “${both.status}”`]), ...tagProblems];
    report.note(step, "helpsBoth", both.cards.length);
    report.check(
      step,
      problems.length === 0,
      `“Helps both” shows ${pl(both.cards.length, "idea")} that help both teams, each tagged with Helps you and Helps them ${min} or more, and the tag is on exactly those cards in every sort`,
      `“Helps both” or its tag reads otherwise`,
      problems,
    );
  }
  report.check(
    step,
    lineProblems.size === 0,
    `in every sort the partner's line shows only with the “Helps both” tag (${pl(lines, "card")} showed it across the ${pl(SORTS.length, "sort")}), never in an “If they won't move: try …” box`,
    "the partner's line shows on a card that doesn't help both, or is missing from one that does",
    [...lineProblems],
  );

  const first = `document.querySelector("article")`;
  // Checkpoint 7h: the card's feedback buttons, its report form and its "Open in Analyzer" are in its Details, closed at first.
  await openCardPanel(page, first, "Details");
  // This league's feedback records in the league store (an expression for an async body: inPage.ts savedFeedback).
  const readFeedback = `(await savedFeedback(tabLeague()))`;

  // An outcome button: on, saved in this browser; pressed again, cleared.
  const button = (label: string) => `[...${first}.querySelectorAll("div[role=group] button")].find((b) => visibleText(b).replace("✓", "").trim() === ${JSON.stringify(label)})`;
  await page.click(button("Rejected"), "the Rejected button");
  // Since Phase 4b, the first outcome pressed on a card that shows two versions (offer-first steps or a Plan B) asks which
  // version first ("Which version did they turn down?"): the check then measures the choice and picks its first version.
  const chooser = `[...${first}.querySelectorAll("fieldset")].find((f) => /^Which version/.test(txt(f.querySelector("legend") || f)))`;
  const pressedOrAsked = await page
    .waitFor<boolean>(`(() => { const b = ${button("Rejected")}; return (b && b.getAttribute("aria-pressed") === "true") || !!(${chooser}); })()`, 5_000, "the outcome to save or to ask which version")
    .catch(() => false);
  let chose = false;
  if (pressedOrAsked && (await page.run<boolean>(`return !!(${chooser});`))) {
    const choice = await page.run<{ buttons: number; small: number }>(`const bs = [...(${chooser}).querySelectorAll("button")]; return { buttons: bs.length, small: bs.filter((b) => b.getBoundingClientRect().height < 44).length };`);
    report.check(step, choice.buttons >= 3 && choice.small === 0, "the version choice offers the card's versions and Cancel, each at least 44 px tall", choice.buttons < 3 ? "the version choice has fewer than two versions and Cancel" : `${pl(choice.small, "button")} in the version choice under 44 px`);
    await page.click(`[...(${chooser}).querySelectorAll("button")][0]`, "the first version offered");
    chose = true;
  }
  const on = await page
    .waitFor<boolean>(`(await (async () => { const b = ${button("Rejected")}; return b && b.getAttribute("aria-pressed") === "true" && ${readFeedback}.some((r) => r.outcome && r.outcome.kind === "rejected"${chose ? " && typeof r.version === \"string\"" : ""}); })())`, 5_000, "the outcome to save")
    .catch(() => false);
  await page.click(button("Rejected"), "the Rejected button");
  const off = await page
    .waitFor<boolean>(`(await (async () => { const b = ${button("Rejected")}; return b && b.getAttribute("aria-pressed") === "false" && !${readFeedback}.some((r) => r.outcome && r.outcome.kind === "rejected"); })())`, 5_000, "the outcome to clear")
    .catch(() => false);
  report.check(step, on && off, `an outcome button (Rejected${chose ? ", after choosing which version" : ""}) saves in this browser and clears when pressed again`, on ? "pressing Rejected again didn't clear it" : "pressing Rejected didn't save it");

  // Report: a reason and a note saved; Undo removes it. The open form's tap targets count too.
  const reportButton = `[...${first}.querySelectorAll("button")].find((b) => visibleText(b) === "Report a problem")`;
  await page.click(reportButton, "Report a problem");
  const form = await page.waitFor<{ reasons: number; m: Measure }>(`(() => { const f = ${first}.querySelector("form"); return f && f.querySelectorAll("input[type=radio]").length ? { reasons: f.querySelectorAll("input[type=radio]").length, m: measure(f) } : null; })()`, 5_000, "the report form").catch(() => null);
  if (!form) {
    report.fail(step, "Report a problem didn't open its reasons");
  } else {
    report.check(step, form.m.smallCount === 0, `the report form's tap targets are at least 44 px tall (${form.m.targets} checked)`, `${pl(form.m.smallCount, "tap target")} in the report form under 44 px`, form.m.small);
    await page.click(`${first}.querySelectorAll("form input[type=radio]")[1].closest("label")`, "a report reason");
    await page.run(`setInput(${first}.querySelector("form textarea"), "check:browser test note"); return true;`);
    await page.click(`${first}.querySelector("form button[type=submit]")`, "Save report");
    const saved = await page
      .waitFor<boolean>(`[...${first}.querySelectorAll("p")].some((p) => txt(p).startsWith("Reported:")) && ${readFeedback}.some((r) => r.report && r.report.note === "check:browser test note")`, 5_000, "the report to save")
      .catch(() => false);
    let undone = false;
    if (saved) {
      await page.click(`[...${first}.querySelectorAll("button")].find((b) => visibleText(b) === "Undo")`, "Undo");
      undone = await page
        .waitFor<boolean>(`!!${reportButton} && !${readFeedback}.some((r) => r.report)`, 5_000, "the report to be removed")
        .catch(() => false);
    }
    report.check(step, saved && undone, `Report saves a reason and a note (${form.reasons} reasons offered), and Undo removes it`, saved ? "Undo didn't remove the report" : "Save report didn't save it");
  }

  // The message to send them: since Checkpoint 7h a closed card shows none; "How to offer it" holds the first offer's (open) and
  // the others', or the card's own when its offers hold the trade alone: offersChecks copies them.
  report.check(
    step,
    !!ctx.firstCard.analyzerHref?.startsWith("/analyzer?") && ctx.firstCard.linkIsOwnTrade,
    "the card links to the Trade Analyzer with its own trade",
    ctx.firstCard.analyzerHref ? "the card's Analyzer link names another trade than the card's" : "the card has no Open in Analyzer link",
  );
  await offersChecks(ctx, step, first);
  // Checkpoint 7h: the first idea's layout with both its controls open (the closed cards are measured with the page by the
  // Trade Finder step; what they hold is hidden there).
  if (await page.run<boolean>(`return panelOpen(${first}, "Details") && panelOpen(${first}, "How to offer it");`, { cards: true })) {
    layoutChecks(ctx, step, await page.run<Measure>(`return measure(${first});`, { cards: true }), "the first idea", "with Details and How to offer it open on the first idea: ");
  }
  // Checkpoint 7f: the cards', boxes' and the first idea's offers' releases at IR returns (its offers are open now), with the
  // near-tie rule's reason when it decided one (review of Checkpoint 7f, PIERCE-1: the lists of roster moves alone).
  await releaseLineChecks(ctx, step, "the trade ideas' roster moves (the first idea's offers open)", "trade");
  // Checkpoint 7g (item 5): the first idea with everything on it opened, after the step's checks; what the shot opens it closes
  // again (shots.ts; nothing with --no-shots).
  await openedCardShot(ctx, step);
}

/**
 * "How to offer it" on the first card (Checkpoint 7e; planner reply to Checkpoint 7d, item 4.1; the lead's check:browser
 * bullet): opened, the engine worker works its offers out (timed: `offersSeconds`); they hold the ladder's rules on the numbers
 * they print (contracts.ts offersProblems: "Open with" at least config.offers.openMinChance, or the minimum chance when that's
 * higher, each offer at least config.search.steps.minAcceptGain likelier than the one before, Helps you above 0 and never
 * rising, each with its own Copy); an offer that is another idea of the list says so with that idea's place, "Also shown as
 * trade idea N." (contracts.ts offersAlsoProblems, the places from the list's data-trade-key: the lead's call, wave D), and no
 * other offer does; since Checkpoint 7f, in the Overall sort (the card step's sorts end on it), none is an idea below the first
 * one (contracts.ts offersMergeProblems: merged ideas); since Checkpoint 7g (planner reply to Checkpoint 7f, answer 3), in the
 * Overall sort, its Last offer is the idea plus one player of mine or the idea asking for fewer of their players
 * (contracts.ts lastOfferShapeProblems) and no idea of the list is a version of another's trade at least as good on both Helps
 * you and the chance as printed (contracts.ts dominatedIdeasProblems, inPage.ts listIdeas); each offer's Copy puts its own
 * message on the clipboard; and every Plan B box the list
 * shows reads the planner's heading, "If they won't move: try …". Runs last in the card step: once open, the offers' messages
 * come before the card's own on the card. The tab's minimum chance is the default (a fresh browser: the Settings step runs
 * after this one).
 */
async function offersChecks(ctx: StepContext, step: string, first: string): Promise<void> {
  const { page, report } = ctx;
  const headings = await page.run<string[]>(`return cardPlanBHeadings();`, { cards: true });
  report.check(
    step,
    headings.every((h) => h === PLAN_B_HEADING),
    headings.length ? `every Plan B box reads “${PLAN_B_HEADING}” (${headings.length} ${headings.length === 1 ? "box" : "boxes"})` : "no Plan B box shows (nothing to read)",
    "a Plan B box reads another heading",
    [...new Set(headings.filter((h) => h !== PLAN_B_HEADING))],
  );
  const has = await page.run<boolean>(`return !!offersDetails(${first});`, { cards: true });
  if (!report.check(step, has, "the first idea has “How to offer it”", "the first idea has no “How to offer it”")) return;
  const started = Date.now();
  await openCardPanel(page, first, "How to offer it");
  const read = await page
    .waitFor<OffersRead>(`(() => { const o = offersData(${first}); return o && (o.offers.length || o.failed || /^Offer this trade as it is/.test(o.status)) ? o : null; })()`, 30_000, "the offers", 50)
    .catch(() => null);
  const took = seconds(Date.now() - started);
  report.note(step, "offersSeconds", took);
  if (!read) {
    report.fail(step, "“How to offer it” didn't answer within 30 s");
    return;
  }
  const openMin = Math.round(Math.max(config.offers.openMinChance, config.ranking.minChanceDefault) * 100);
  const gain = Math.round(config.search.steps.minAcceptGain * 100);
  const suggested = [OFFER_STEP_LABEL.suggested, ANALYZER_SUGGESTED_LABEL];
  const problems = offersProblems(read, { openMin, gain, suggested });
  report.note(step, "offers", read.offers.map((o) => `${o.label}: Helps you ${o.helps ?? "?"}, ${o.chance ?? "?"}${o.also ? ` (${o.also})` : ""}`));
  report.check(
    step,
    problems.length === 0,
    read.offers.length
      ? `“How to offer it” lists ${pl(read.offers.length, "offer")} in ${took} s, each at least ${gain} points likelier than the one before (the first at least ${openMin}%), Helps you above 0 and never rising, each with its own Copy`
      : `“How to offer it” says to offer the trade as it is, in ${took} s`,
    "“How to offer it” breaks its rules",
    problems,
  );
  // An offer that is another idea shown says so with that idea's place (the lead's call for Checkpoint 7e's wave D:
  // contracts.ts offersAlsoProblems, the list's places read from its items' data-trade-key).
  // The sort shown and the first idea's key (the merge's and Checkpoint 7g's checks read the Overall sort).
  const shown = await page.run<{ sort: string; key: string | null }>(`const s = document.getElementById("finder-sort"); const li = ${first}.closest("li[data-trade-key]"); return { sort: s ? s.value : "", key: li ? li.getAttribute("data-trade-key") : null };`, { cards: true });
  if (read.offers.length) {
    const places = await page.run<Record<string, number>>(`return cardPlaces(${first});`, { cards: true });
    const alsoProblems = offersAlsoProblems(read, places, suggested);
    const labeled = read.offers.filter((o) => o.also).length;
    report.check(
      step,
      alsoProblems.length === 0,
      labeled
        ? `${pl(labeled, "offer")} that ${labeled === 1 ? "is another idea shown says" : "are other ideas shown say"} so with ${labeled === 1 ? "its" : "their"} place (“Also shown as trade idea N.”), and no other offer does`
        : "no offer is another idea shown, and none says it is",
      "an offer's “Also shown as trade idea N.” is missing or wrong",
      alsoProblems,
    );
    // Checkpoint 7f (planner reply to Checkpoint 7e, decision 3: merged ideas): in the Overall sort, the first idea's offers
    // include no idea below it, which the merge shows among its offers only (contracts.ts offersMergeProblems).
    if (shown.sort !== "overall" || !shown.key) report.skip(step, `the merge's check needs the Overall sort and the idea's key (the sort reads “${shown.sort}”)`);
    else {
      const mergeProblems = offersMergeProblems(read, places, shown.key, suggested);
      report.check(step, mergeProblems.length === 0, "the first idea's offers include no idea below it on Overall (the merge shows those among its offers only)", "the first idea's offers include an idea below it on Overall", mergeProblems);
      // Checkpoint 7g (planner reply to Checkpoint 7f, answer 3(a)): its Last offer is the idea plus one player of yours or the
      // idea asking for fewer of their players (contracts.ts lastOfferShapeProblems, from the offer's key and the idea's).
      const last = read.offers.find((o) => o.label === "Last offer");
      const shapeProblems = lastOfferShapeProblems(read, shown.key);
      const fewer = last ? (tradeKeyParts(last.key)?.get.length ?? 0) < (tradeKeyParts(shown.key)?.get.length ?? 0) : false;
      report.check(
        step,
        shapeProblems.length === 0,
        last ? `the first idea's Last offer is the idea ${fewer ? "asking for fewer of their players" : "plus one player of yours"}` : "the first idea has no Last offer (nothing to check on its shape)",
        "the first idea's Last offer is neither the idea plus one player of yours nor the idea asking for fewer of theirs",
        shapeProblems,
      );
    }
  }
  // Checkpoint 7g (planner reply to Checkpoint 7f, answer 3(c)): in the Overall sort, no idea of the list is a version of
  // another's trade at least as good on both Helps you and the chance as printed (contracts.ts dominatedIdeasProblems, the
  // list read by inPage.ts listIdeas).
  if (shown.sort !== "overall") report.skip(step, `the dropped versions' check needs the Overall sort (the sort reads “${shown.sort}”)`);
  else {
    const ideas = await page.run<IdeaRead[]>(`return listIdeas(${first});`, { cards: true });
    const dropProblems = dominatedIdeasProblems(ideas);
    report.check(
      step,
      dropProblems.length === 0,
      `no idea of the list is a version of another's trade at least as good on both Helps you and the chance (${pl(ideas.length, "idea")} read)`,
      "an idea shows though another version of the same trade is at least as good on both",
      dropProblems,
    );
  }
  // Each offer's own message: opened, then Copy (a trusted tap) puts it on the clipboard.
  const copies: string[] = [];
  for (let i = 0; i < read.offers.length; i++) {
    const details = `[...offersDetails(${first}).querySelector("ol").children[${i}].querySelectorAll("details")].find((d) => txt(d.querySelector("summary")).startsWith("Message to send them"))`;
    try {
      // The first offer's message shows open (Checkpoint 7h; planner reply to Checkpoint 7g, §1); the others open with a tap.
      if (!(await page.run<boolean>(`const d = ${details}; return !!d && d.open;`, { cards: true }))) await page.click(`${details}.querySelector("summary")`, `offer ${i + 1}'s message`);
      await page.click(`${details}.querySelector("button")`, `offer ${i + 1}'s Copy`);
    } catch (err) {
      copies.push(`offer ${i + 1}: ${err instanceof Error ? err.message : "its message couldn't be opened"}`);
      continue;
    }
    const copied = await page
      .waitFor<string>(`(() => { const b = ${details}.querySelector("button"); const t = b ? txt(b) : ""; return t === "Copied!" ? "copied" : t.startsWith("Select the text") ? "refused" : null; })()`, 5_000, `offer ${i + 1}'s copy`)
      .catch(() => "no answer");
    const clip = await page.run<{ same: boolean; read: boolean }>(
      `const d = ${details}; const text = d ? txt(d.querySelector("div p")) : ""; try { const c = await navigator.clipboard.readText(); return { same: txt({ textContent: c }) === text, read: true }; } catch (e) { return { same: false, read: false }; }`,
      { cards: true },
    );
    if (copied !== "copied") copies.push(`offer ${i + 1}: Copy ${copied === "refused" ? "says the browser refused the clipboard" : "didn't answer"}`);
    else if (clip.read && !clip.same) copies.push(`offer ${i + 1}: the clipboard doesn't hold its message`);
  }
  if (read.offers.length) report.check(step, copies.length === 0, `each offer's Copy puts its own message on the clipboard (${pl(read.offers.length, "offer")})`, "an offer's Copy doesn't work", copies);
  // Checkpoint 7h: no numbered list (the trade alone, or a failure): the card's own message, open in "How to offer it".
  if (!read.offers.length) {
    const details = `firstMessage(${first})`;
    if (!(await page.run<boolean>(`return !!${details};`, { cards: true }))) {
      report.fail(step, "“How to offer it” shows no message to send them");
      return;
    }
    const opened = await page.run<boolean>(`return ${details}.open;`, { cards: true });
    if (!opened) await page.click(`${details}.querySelector("summary")`, "Message to send them");
    await page.click(`${details}.querySelector("button")`, "Copy message");
    const copied = await page
      .waitFor<string>(`(() => { const b = ${details}.querySelector("button"); const t = b ? txt(b) : ""; return t === "Copied!" ? "copied" : t.startsWith("Select the text") ? "refused" : null; })()`, 5_000, "the copy")
      .catch(() => "no answer");
    const clip = await page.run<{ same: boolean; read: boolean }>(
      `const d = ${details}; const text = d ? txt(d.querySelector("div p")) : ""; try { const c = await navigator.clipboard.readText(); return { same: txt({ textContent: c }) === text, read: true }; } catch (e) { return { same: false, read: false }; }`,
      { cards: true },
    );
    report.check(
      step,
      opened && copied === "copied" && (clip.same || !clip.read),
      clip.read ? "“How to offer it” shows the card's message open, and Copy puts it on the clipboard" : "“How to offer it” shows the card's message open, and Copy says Copied! (the clipboard couldn't be read back here)",
      !opened ? "the card's message in “How to offer it” wasn't open" : copied === "refused" ? "Copy says the browser refused the clipboard" : copied === "copied" ? "the clipboard doesn't hold the message" : "Copy didn't answer",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Trade Analyzer

const ANALYZER_DONE = `(() => { if (location.pathname !== "/analyzer") return null; const none = noImport(); if (none) return "error: the page says " + none; const l = statusLines(); if (l.some((t) => /^Evaluated/.test(t))) return "evaluated"; if (l.some((t) => /^This trade can't be made/.test(t))) return "illegal"; const a = alerts(); return a.length ? "error: " + a[0] : null; })()`;

export async function analyzerStep(ctx: StepContext): Promise<void> {
  const step = "Analyzer";
  const { page, report } = ctx;
  page.step = step;
  const card = ctx.firstCard;
  if (!card?.analyzerHref) {
    report.skip(step, ctx.myTeam ? "no trade idea to open" : "no team picked");
    return;
  }
  // Checkpoint 7h: "Open in Analyzer" is in the card's Details.
  await openCardPanel(page, `document.querySelector("article")`, "Details");
  const started = Date.now();
  await page.click(`ownAnalyzerLink(document.querySelector("article"))`, "Open in Analyzer");
  const state = await page.waitFor<string>(ANALYZER_DONE, 120_000, "the evaluation", 50).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
  const took = seconds(Date.now() - started);
  report.note(step, "evaluateSeconds", took);
  if (!report.check(step, state === "evaluated", `opened and evaluated the first idea in ${took} s`, state === "illegal" ? "the Analyzer says the first idea can't be made" : `the evaluation didn't finish: ${state.replace(/^error: /, "")}`)) return;
  await sleep(400);

  const shown = await page.run<CardInfo | null>(`const a = document.querySelector("article"); return a ? cardData(a) : null;`, { cards: true });
  if (!shown) {
    report.fail(step, "the evaluation shows no trade card");
  } else {
    const same = shown.helps === card.helps && shown.accept === card.accept && shown.overall === card.overall;
    report.check(
      step,
      same,
      `the same three numbers as the Trade Finder's card (${shown.helps} · ${shown.accept} · ${shown.overall})`,
      `its numbers differ from the Trade Finder's card`,
      [`Trade Finder: ${card.helps} · ${card.accept} · ${card.overall}`, `Analyzer: ${shown.helps} · ${shown.accept} · ${shown.overall}`],
    );
    // Checkpoint 7c (planner reply to Checkpoint 7b, §7: "The Analyzer shows the same"): the partner's score and the tag. Since
    // Checkpoint 7d (planner reply to Checkpoint 7c, answer 3: "The Analyzer always shows them, including when the trade hurts
    // the other team") its card shows the partner's line whatever it is, the Trade Finder's card only with the tag; so its tag
    // is also held to its own printed scores, which only it shows for an untagged idea (review of Checkpoint 7d, cards-export-3).
    const them = (c: CardInfo) => `${c.helpsThem === null ? "no “Helps them” line" : `Helps them ${c.helpsThem}`}${c.helpsBothTag ? ", tagged “Helps both”" : ""}`;
    const lineProblems = analyzerPartnerLineProblems(shown, card, config.benefit.helpsThemMin);
    report.check(
      step,
      lineProblems.length === 0,
      `its card shows the partner's line (${them(shown)}), tagged as its own scores call for, and the Trade Finder's card ${card.helpsThem === null ? "none, untagged" : "the same"}`,
      "its partner's line or tag isn't as its own scores and the Trade Finder's card call for",
      [`Trade Finder: ${them(card)}`, `Analyzer: ${them(shown)}`, ...lineProblems],
    );
    // Both sides first (the tag check counts under "You give"), then the tags.
    const sideless = sidelessCards([shown]);
    if (report.check(step, sideless.length === 0, "it shows what you give and what you get", `its card lacks a "You give" or "You get" player`, sideless)) {
      report.check(step, shown.tagsOnMySide === 0, `no "Harder to get" tag on a player you'd give`, `"Harder to get" shows on a player you'd give`);
    }
    // Phase 7b (5.4): no FantasyCalc value on the card, its "Details" included, and its credit.
    await cardValueChecks(ctx, step, () => "the Analyzer's card", await readTradingLeague(ctx));
    // Checkpoint 7c: its odds lines as the Trade Finder's.
    await cardOddsChecks(ctx, step, () => "the Analyzer's card");
    // Checkpoint 7e (item 4.2): its "now or after this week" line, with its evaluation.
    await nowOrLaterChecks(ctx, step, "analyzer");
    // Checkpoint 7f: its card's releases at IR returns, worded as the Trade Finder's (review of Checkpoint 7f, PIERCE-1).
    await releaseLineChecks(ctx, step, "the Analyzer's roster moves", "trade");
  }
  await fantasyCalcDomCheck(ctx, step);
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "05-analyzer");

  const from = await mark(page);
  const back = Date.now();
  await page.click(`[...document.querySelectorAll("a")].find((a) => txt(a) === "Back to the Trade Finder")`, "Back to the Trade Finder");
  const again = await page.waitFor<string>(FINDER_DONE, 120_000, "the Trade Finder again", 50).catch(() => "no");
  // The worker answers each search it runs; a page that remembered the ideas asks it nothing (its progress bar can flash for one render).
  const searchedAgain = await page.run<boolean>(`return engineSince(${from}).some((e) => e.type === "trades");`).catch(() => false);
  report.check(
    step,
    again === "done",
    `Back to the Trade Finder shows the ideas again in ${seconds(Date.now() - back)} s (${searchedAgain ? "after a new search" : "remembered, no new search"})`,
    "Back to the Trade Finder didn't show the ideas again",
  );
  if (again === "done") await analyzerBackLinkCheck(ctx, step);
}

/** The Trade Analyzer's link back to the Trade Finder, found by its words (an expression for the page). */
export const BACK_LINK = `[...document.querySelectorAll("main a")].find((a) => txt(a) === "Back to the Trade Finder")`;

/**
 * "Back to the Trade Finder" isn't prefetched (Phase 7b; AnalyzerPage.tsx: links whose address carries a team id reach
 * the server only when opened). Its address must carry one for the check to mean anything (the header's own "/trades" is
 * prefetched, and carries none), so the Trade Finder first shows one partner's ideas (the last partner: the second-league
 * step picks the first and expects a fresh search); the Analyzer then opens from the Finder's own link, and no request
 * names the back link's address, team id included, until it's tapped. The tap's own request is the proof the requests
 * are seen at all: without it the check can't tell, and says so.
 */
async function analyzerBackLinkCheck(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const partners = await page.run<string[]>(`const s = document.getElementById("finder-partner"); return s ? [...s.options].map((o) => o.value).filter(Boolean) : [];`);
  const partner = partners.length >= 2 ? (partners[partners.length - 1] as string) : null;
  if (!partner) {
    report.skip(step, "“Back to the Trade Finder” isn't prefetched: the Trade Finder offers too few partners to pick one");
    return;
  }
  const from = await mark(page);
  await page.run(`setSelect(document.getElementById("finder-partner"), ${JSON.stringify(partner)}); return true;`);
  const searched = await page
    .waitFor<boolean>(`location.search === ${JSON.stringify(`?partner=${partner}`)} && engineSince(${from}).some((e) => e.type === "trades") && ${FINDER_DONE} === "done"`, 120_000, "the one-partner search", 50)
    .catch(() => false);
  if (!searched) {
    report.fail(step, "picking a partner on the Trade Finder didn't search, so the Analyzer's link back couldn't carry one");
    return;
  }
  const opened = page.requestMark();
  await page.click(`[...document.querySelectorAll("main a")].find((a) => a.getAttribute("href") === "/analyzer")`, "the Trade Finder's link to the Trade Analyzer");
  const href = await page.waitFor<string>(`location.pathname === "/analyzer" && (() => { const a = ${BACK_LINK}; return a ? a.getAttribute("href") : null; })()`, 60_000, "“Back to the Trade Finder”").catch(() => null);
  if (href === null) {
    report.fail(step, "the Trade Analyzer opened from the Trade Finder has no “Back to the Trade Finder” link");
    return;
  }
  if (!/[?&]partner=/.test(href)) {
    report.skip(step, `“Back to the Trade Finder” isn't prefetched: its address (${href}) carries no team id, so a prefetch of it couldn't be told from the header's own`);
    return;
  }
  // Time for a prefetch to happen: Next prefetches a link once it's on screen.
  await sleep(2_000);
  const before = page.appRequestsSince(opened).filter((r) => requestNamesAddress(r.path, href));
  const tapped = page.requestMark();
  await page.click(BACK_LINK, "Back to the Trade Finder");
  const back = await page.waitFor<string>(FINDER_DONE, 120_000, "the Trade Finder", 50).catch(() => "no");
  await sleep(300);
  const after = page.appRequestsSince(tapped).filter((r) => requestNamesAddress(r.path, href));
  const described = (list: AppRequest[]) => list.map((r) => `${r.method} ${r.path}${r.prefetch ? " (a prefetch)" : ""}`);
  if (before.length) report.fail(step, `“Back to the Trade Finder” was fetched before it was tapped: its address, team id included, reached the server unasked`, described(before));
  else if (after.length) report.ok(step, `“Back to the Trade Finder” isn't prefetched: no request for ${href} until it was tapped (then ${pl(after.length, "request")})`);
  else report.skip(step, `“Back to the Trade Finder” isn't prefetched: no request for ${href} was seen, the tap's own included (Next had it in memory), so a prefetch couldn't have been seen either`);
  if (back !== "done") report.fail(step, `“Back to the Trade Finder” (${href}) didn't show the partner's ideas again`);
}

// ---------------------------------------------------------------------------------------------
// 6b. The waiver view (Phase 7b)

/** The header's link to the League page's "Waiver upgrades" (src/lib/waiversLink.ts WAIVERS_HREF). */
export const WAIVERS_HREF = "/league#waivers";

/** What inPage.ts READ_WAIVERS reads (no names). */
interface WaiversRead {
  /** Checkpoint 7e: the season list's rating line (empty once rated or when it can't be), the switch, and the rows as moves. */
  status?: string | null;
  switch?: { label: string | null; on: boolean; help: string | null } | null;
  /**
   * The rows above the fold (since Checkpoint 7f the rows that help, then since its review, WAIVERS-1, the moves that can't be
   * made), as moves; `rows` counts them.
   */
  moves?: WaiverMoveRead[];
  /**
   * Checkpoint 7f (planner reply to Checkpoint 7e, item 3): the folded rows as moves (there while the fold is open), how many,
   * their list's id and whether it's right after the button's block, the fold's button, the line when no row helps, the list's
   * label (the toggle's button pressed, "Rest of season" when there's no toggle), whether it's rated by Helps you (the list's
   * data-rated) and how many rows it has (data-waiver-total; review of Checkpoint 7f, WAIVERS-3).
   */
  restMoves?: WaiverMoveRead[];
  restRows?: number;
  restId?: string | null;
  restAfter?: boolean | null;
  rest?: WaiverFoldRead["rest"];
  none?: string | null;
  label?: string | null;
  rated?: boolean | null;
  total?: number | null;
  section: boolean;
  /** Without the section: the League page says the season is over (nothing left to list). */
  over?: boolean;
  path: string;
  hash: string;
  history: number;
  active: string;
  heading?: string | null;
  focused?: boolean;
  headingTop?: number | null;
  headingBottom?: number | null;
  viewport?: number;
  inView?: boolean;
  toggle?: Array<{ label: string; pressed: string | null; height: number; width: number }> | null;
  more?: { text: string; expanded: string | null; height: number; width: number } | null;
  rows?: number;
  list?: boolean;
}

/** The section revealed: the League page at /league#waivers, its heading focused and on screen (a waitFor expression). */
export const WAIVERS_REVEALED = `(() => { const s = document.getElementById("waivers"); const h = s && s.querySelector("h2"); if (!h || document.activeElement !== h || location.pathname !== "/league" || location.hash !== "#waivers") return null; const r = h.getBoundingClientRect(); return r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1; })()`;

/** Whether the waiver view's toggle button `i` is the one pressed, alone (a waitFor expression). */
export const togglePressed = (i: number) =>
  `(() => { const bs = [...document.querySelectorAll('#waivers [role=group][aria-label="Which weeks"] button')]; return bs.length > ${i} && bs[${i}].getAttribute("aria-pressed") === "true" && bs.filter((b) => b.getAttribute("aria-pressed") === "true").length === 1; })()`;

/** Whether the waiver list's fold is open (aria-expanded true, its rows there) or closed (false, none): a waitFor expression (Checkpoint 7f). */
export const waiverFoldOpen = (open: boolean) =>
  `(() => { const b = document.querySelector("#waivers button[data-waiver-more]"); const ul = document.querySelector('#waivers ul[data-waiver-rows="rest"]'); return !!b && b.getAttribute("aria-expanded") === "${String(open)}" && ${open ? "!!ul" : "!ul"}; })()`;

/** How long the Waivers step waits for the season list's rating (its own request: about a second on Parker's league in Node). */
export const WAIVER_RATING_WAIT_MS = 60_000;

/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, items 3.1–3.4): the season list's rating comes on its own request (its line,
 * "Rating these against your odds…", gone within WAIVER_RATING_WAIT_MS, never the failure's words; how long it took is noted),
 * "Drop from the same position" with its help, and every row shown as one move (contracts.ts waiverMoveProblems): Helps you on
 * the rated season list (the lineup gain where the season can't be simulated), a lock next to each drop; then, on the
 * toggle's other lists, the lineup gain. The toggle is put back on the season list. Checkpoint 7f (planner reply to
 * Checkpoint 7e, item 3): on each list, the rows above the fold and the fold of the rest (waiverListChecks); since the review
 * of Checkpoint 7f (WAIVERS-5) on every list of the toggle, not only its second, and with a fold open, the section's layout
 * once and the toggle's tap away and back. Exported so an offline harness can run it on the real component (the review's
 * fixes did, on Parker's lists).
 */
export async function waiverMoveChecks(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const started = Date.now();
  let r = await page.run<WaiversRead>(READ_WAIVERS);
  while (r.status === RATING_PENDING_TEXT && Date.now() - started < WAIVER_RATING_WAIT_MS) {
    await sleep(250);
    r = await page.run<WaiversRead>(READ_WAIVERS);
  }
  const waited = Date.now() - started;
  report.note(step, "waiverRatingMs", waited);
  report.check(
    step,
    r.status !== RATING_PENDING_TEXT && r.status !== RATING_FAILED_TEXT,
    `“Rest of season” is rated (or needs no rating) ${seconds(waited)} s after the section showed`,
    r.status === RATING_FAILED_TEXT ? `the rating failed: “${RATING_FAILED_TEXT}”` : `the rating didn't come within ${seconds(WAIVER_RATING_WAIT_MS)} s`,
  );
  const sw = r.switch ?? null;
  report.check(
    step,
    !!sw && sw.label === SAME_POSITION_LABEL && sw.help === SAME_POSITION_HELP,
    `“${SAME_POSITION_LABEL}” is a switch with its help (${sw?.on ? "on" : "off"})`,
    !sw ? `no “${SAME_POSITION_LABEL}” switch` : `the switch reads “${sw.label ?? ""}”, its help “${sw.help ?? "(none)"}”`,
  );
  const toggle = r.toggle ?? null;
  const at = { index: 0, toggles: toggle ?? [], measured: { done: false } };
  await waiverListChecks(ctx, step, r, r.label ?? "Rest of season", at);
  // Checkpoint 7h (planner reply to Checkpoint 7g, section 5): its rows' odds lines, and a row's "Details" (steps7h.ts).
  await waiverDetailsChecks(ctx, step, r.label ?? "Rest of season", !!r.rated);
  if (!r.rated && ((r.moves ?? []).length || r.rest)) report.info(step, "“Rest of season” isn't rated by Helps you here (no season to simulate): its rows show the lineup gain");
  if (!toggle || toggle.length < 2) return;
  // Every other list of the toggle (review of Checkpoint 7f, WAIVERS-5: only the second was read, so a week under way's
  // "Next week" never was).
  for (let i = 1; i < toggle.length; i++) {
    await page.click(waiverToggle(i), `the toggle's “${toggle[i]?.label ?? ""}”`);
    await page.waitFor<boolean>(togglePressed(i), 5_000, "the toggle to follow the tap").catch(() => false);
    const list = await page.run<WaiversRead>(READ_WAIVERS);
    await waiverListChecks(ctx, step, list, list.label ?? toggle[i]?.label ?? "", { ...at, index: i });
    await waiverDetailsChecks(ctx, step, list.label ?? toggle[i]?.label ?? "", !!list.rated);
  }
  await page.click(waiverToggle(0), "the toggle's “Rest of season”");
  await page.waitFor<boolean>(togglePressed(0), 5_000, "the toggle to follow the tap back").catch(() => false);
}

/** The fold as contracts.ts waiverFoldProblems reads it, from READ_WAIVERS. */
function foldRead(r: WaiversRead): WaiverFoldRead {
  const shown = r.moves ?? [];
  return { rest: r.rest ?? null, rows: shown.length, helping: shown.filter((m) => waiverRowHelps(m)).length, restRows: r.restRows ?? 0, restId: r.restId ?? null, restAfter: r.restAfter ?? null, none: r.none ?? null };
}

/** How many rows a list shows above the fold: "Show all N"'s N, else those in the page ("Show fewer" or no button: all of them). */
function aboveTheFold(r: WaiversRead): number {
  const all = /^Show all (\d+)$/.exec(r.more?.text ?? "");
  return all ? Number(all[1]) : (r.moves ?? []).length;
}

/** Where a list sits in the toggle (its button's index and the toggle's buttons), and whether a fold was measured open yet. */
interface WaiverListAt {
  index: number;
  toggles: NonNullable<WaiversRead["toggle"]>;
  measured: { done: boolean };
}

/**
 * One waiver list, as the page shows it (Checkpoint 7f; planner reply to Checkpoint 7e, item 3: "Show the rows that rate above
 * 0, followed by a collapsed “N more pickups that don't help you (show).”"; contracts.ts decides): above the fold, each row
 * that helps reads as one move with its main number above 0 (Helps you on a rated list, the lineup gain otherwise:
 * waiverMoveProblems, waiverSplitProblems), then (its review, WAIVERS-1) each move that can't be made, or a line says none
 * helps; every row of the list is above the fold or counted by the fold (waiverTotalProblems, from the list's
 * data-waiver-total: review of Checkpoint 7f, WAIVERS-3, a fold gone missing read as a skip); then the fold
 * (waiverFoldProblems): tapped, its rows appear right after its block, as many as it says, each "No gain", and keyboard
 * focus stays on its button; tapped again, they go and focus stays. A list with nothing folded: a skip line. ⚠️ Ours: while
 * it's open, the section is read for trade values (pageValueLeaks, the League step's own rule), since the League step's scan of
 * the page no longer reaches the rows that don't help (their "Why no gain" lines among them) while they're folded. Then,
 * opened again (review of Checkpoint 7f, WAIVERS-5): the section's layout with a fold open, on the first list that has one
 * (measure(): the League step's measure ran with every fold closed), and a tap on the toggle to another list and back,
 * after which the fold is closed.
 */
async function waiverListChecks(ctx: StepContext, step: string, r: WaiversRead, label: string, at: WaiverListAt): Promise<void> {
  const { page, report } = ctx;
  const name = `“${label}”`;
  const shown = r.moves ?? [];
  const main = r.rated ? "Helps you" : "Lineup gain";
  const totals = waiverTotalProblems(r.total ?? null, aboveTheFold(r), r.rest?.text ?? null);
  if (!r.list || (!shown.length && !r.none && !r.rest)) {
    if (r.list && totals.length) report.fail(step, `${name} shows no row, though it has some: ${totals.join("; ")}`);
    else report.skip(step, `the waiver rows: ${name} lists none`);
    return;
  }
  const split = [...waiverMoveProblems(shown, { main, locks: true }), ...waiverSplitProblems(shown, [], r.none ?? null, label)];
  const helping = shown.filter((m) => waiverRowHelps(m)).length;
  const cant = shown.length - helping;
  const each = helping === 1 ? "1 row that helps above the fold, one move" : `${pl(helping, "row")} that help above the fold, each one move`;
  const then = cant ? `, then ${pl(cant, "move")} that can't be made` : "";
  report.check(
    step,
    split.length === 0,
    helping ? `${name}: ${each} (add him, drop the player named) with ${main} above 0 and how his points compare, a lock next to each drop${then}` : `${name}: no row helps, and the list says so (“${r.none ?? ""}”)${then}`,
    `${pl(split.length, "problem")} with ${name}'s rows above the fold`,
    split,
  );
  report.check(step, totals.length === 0, `${name}: all ${pl(r.total ?? 0, "row")} accounted for, above the fold or counted by its fold`, `${name} doesn't account for all its rows`, totals);
  const closed = r.rest ?? null;
  if (!closed) {
    report.skip(step, `the fold on ${name}: no row reads “No gain”, so nothing is folded`);
    return;
  }
  await page.click(WAIVER_REST, `“${closed.text}”`);
  const opened = await page.waitFor<boolean>(waiverFoldOpen(true), 5_000, "the fold to open").catch(() => false);
  const open = await page.run<WaiversRead>(READ_WAIVERS);
  const leaks = opened ? pageValueLeaks(await page.run<string>(cleaning(ctx) + READ_WAIVERS_TEXT)) : [];
  await page.click(WAIVER_REST, `“${open.rest?.text ?? closed.text}”`);
  const shut = await page.waitFor<boolean>(waiverFoldOpen(false), 5_000, "the fold to close").catch(() => false);
  const after = await page.run<WaiversRead>(READ_WAIVERS);
  const folded = open.restMoves ?? [];
  const problems = [
    ...waiverFoldProblems(foldRead(r), label).map((p) => `before a tap: ${p}`),
    ...(opened ? [] : ["a tap didn't open it (aria-expanded true, its rows after it)"]),
    ...waiverFoldProblems(foldRead(open), label).map((p) => `after a tap: ${p}`),
    ...(open.rest?.focused ? [] : [`after a tap, keyboard focus is on ${open.active}, not the fold's button`]),
    ...waiverMoveProblems(folded, { main, locks: true }).map((p) => `folded ${p}`),
    ...waiverSplitProblems(open.moves ?? [], folded, open.none ?? null, label),
    ...(shut ? [] : ["another tap didn't fold them again"]),
    ...waiverFoldProblems(foldRead(after), label).map((p) => `after another tap: ${p}`),
    ...(after.rest?.focused ? [] : [`after another tap, keyboard focus is on ${after.active}, not the fold's button`]),
  ];
  report.check(
    step,
    problems.length === 0,
    `“${closed.text}” shows ${pl(open.restRows ?? 0, "row")} (aria-expanded true), each one move that doesn't help, keeps keyboard focus, and folds them again`,
    `${pl(problems.length, "problem")} with ${name}'s fold`,
    problems,
  );
  if (opened)
    report.check(
      step,
      leaks.length === 0,
      `no trade-market number or value comparison in ${name} with its fold open (hover texts included)`,
      `${pl(leaks.length, "trade value")} in ${name}'s folded rows: Offer Sheet never displays FantasyCalc's values (their condition 4)`,
      leaks,
    );
  // Opened again (review of Checkpoint 7f, WAIVERS-5): the section's layout with a fold open, once, and the toggle to another
  // list and back, which folds it ("Show all" too).
  if (!opened || (at.measured.done && at.toggles.length < 2)) return;
  await page.click(WAIVER_REST, `“${closed.text}”`);
  if (!(await page.waitFor<boolean>(waiverFoldOpen(true), 5_000, "the fold to open again").catch(() => false))) {
    report.fail(step, `${name}'s fold didn't open a second time`);
    return;
  }
  if (!at.measured.done) {
    at.measured.done = true;
    layoutChecks(ctx, step, await page.run<Measure>(`return measure(document.getElementById("waivers"));`), `the waiver view with ${name}'s fold open`, `with ${name}'s fold open: `);
  }
  if (at.toggles.length < 2) {
    await page.click(WAIVER_REST, `“${closed.text.replace(/\(show\)$/, "(hide)")}”`);
    await page.waitFor<boolean>(waiverFoldOpen(false), 5_000, "the fold to close").catch(() => false);
    return;
  }
  const other = at.index === 0 ? 1 : 0;
  const otherLabel = at.toggles[other]?.label ?? "";
  await page.click(waiverToggle(other), `the toggle's “${otherLabel}”`);
  const away = await page.waitFor<boolean>(togglePressed(other), 5_000, "the toggle to follow the tap").catch(() => false);
  const there = await page.run<WaiversRead>(READ_WAIVERS);
  await page.click(waiverToggle(at.index), `the toggle's “${label}”`);
  const back = await page.waitFor<boolean>(togglePressed(at.index), 5_000, "the toggle to follow the tap back").catch(() => false);
  const here = await page.run<WaiversRead>(READ_WAIVERS);
  const allFolded = (x: WaiversRead) => (!x.rest || (x.rest.expanded === "false" && (x.restRows ?? 0) === 0)) && (!x.more || x.more.expanded === "false");
  const bounce = [
    ...(away ? [] : [`tapping “${otherLabel}” didn't move the toggle to it`]),
    ...(allFolded(there) ? [] : [`on “${otherLabel}”, a list is open (“${there.rest?.text ?? there.more?.text ?? ""}”)`]),
    ...(back ? [] : [`tapping ${name} didn't move the toggle back`]),
    ...(!here.rest ? [`back on ${name}, its fold is gone`] : allFolded(here) ? [] : [`back on ${name}, its fold is still open (“${here.rest.text}”)`]),
  ];
  report.check(step, bounce.length === 0, `with ${name}'s fold open, the toggle to “${otherLabel}” and back folds it again`, `${pl(bounce.length, "problem")} with ${name}'s fold across the toggle`, bounce);
}

/** Why the section didn't count as revealed, in words. */
function revealProblem(r: WaiversRead): string {
  if (!r.section) return "the League page has no Waiver upgrades section (#waivers)";
  if (r.path !== "/league" || r.hash !== "#waivers") return `the address is ${r.path}${r.hash}, not ${WAIVERS_HREF}`;
  if (r.heading !== "Waiver upgrades") return `its heading reads “${r.heading ?? ""}”, not “Waiver upgrades”`;
  if (!r.focused) return `keyboard focus is on ${r.active}, not its heading`;
  if (!r.inView) return `its heading is at ${r.headingTop ?? "?"}–${r.headingBottom ?? "?"} px, off the ${r.viewport ?? "?"} px screen`;
  return "it didn't come into view";
}

/**
 * The waiver view (planner reply to Checkpoint 7a, §6.2), from the Trade Finder: the header's "Waivers" link opens the League
 * page, and once it has computed, "Waiver upgrades" comes into view with keyboard focus on its heading; tapped again from the
 * top of the page, the same, without a new history entry. At 375 px: its toggle (two lists, or three while a week is under
 * way with games left), each button a 44 px target whose aria-pressed follows a tap; "Show all N" (when more rows help than
 * show at first) flips aria-expanded and shows all N; the section's layout. Checkpoint 7f: each list's fold of the rows that
 * don't help (waiverMoveChecks, waiverListChecks).
 */
export async function waiversStep(ctx: StepContext): Promise<void> {
  const step = "Waivers";
  const { page, report } = ctx;
  page.step = step;
  if (!ctx.myTeam) {
    report.skip(step, "the waiver view lists pickups for your team: no team picked");
    return;
  }
  if ((await page.run<string>("return location.pathname;")) !== "/trades") {
    await page.click(`navLink("/trades")`, "the nav's Trades link");
    await page.waitFor<string>(FINDER_DONE, 300_000, "the Trade Finder", 50).catch(() => null);
  }
  await page.click(`navLink(${JSON.stringify(WAIVERS_HREF)})`, "the header's Waivers link");
  const state = await page.waitFor<string>(LEAGUE_READY, 400_000, "the League page", 250).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't load"}`);
  if (!report.check(step, state === "ready", "the header's Waivers link opened the League page", `the League page didn't load from the Waivers link: ${state.replace(/^error: /, "")}`)) return;
  const shown = await page.waitFor<boolean>(WAIVERS_REVEALED, 15_000, "“Waiver upgrades” to come into view").catch(() => false);
  const first = await page.run<WaiversRead>(READ_WAIVERS);
  if (!first.section) {
    // The season is over for the league: no week left to pick anyone up for (WaiverUpgrades.tsx renders nothing then).
    if (first.over) report.skip(step, "the waiver view: the League page says the season is over, so there's nothing to pick up for");
    else report.fail(step, revealProblem(first));
    return;
  }
  report.check(step, shown && first.heading === "Waiver upgrades", "once the League page has computed, “Waiver upgrades” comes into view with keyboard focus on its heading", revealProblem(first));

  // Again from the top of the page, focus elsewhere: the same, and no new history entry (the address already ends in it).
  await page.run(`window.scrollTo(0, 0); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); await sleep(300); return true;`);
  const top = await page.run<WaiversRead>(READ_WAIVERS);
  await page.click(`navLink(${JSON.stringify(WAIVERS_HREF)})`, "the header's Waivers link");
  const again = await page.waitFor<boolean>(WAIVERS_REVEALED, 10_000, "“Waiver upgrades” to come into view again").catch(() => false);
  await sleep(300);
  const second = await page.run<WaiversRead>(READ_WAIVERS);
  if (top.inView) report.skip(step, "the Waivers link tapped again: the section is on the first screen already, so a second tap shows nothing new");
  else
    report.check(
      step,
      again && second.history === top.history,
      `tapped again from the top of the page, it comes back into view with its heading focused, and the history stays at ${top.history} entries`,
      again ? `the second tap added a history entry (${top.history} → ${second.history})` : revealProblem(second),
    );

  // Checkpoint 7e: the season list rated, the switch, and the rows as moves (then the toggle's second list's).
  await waiverMoveChecks(ctx, step);

  // The toggle: its buttons, each a 44 px target, and aria-pressed following a tap (then back).
  const toggle = second.toggle ?? null;
  if (!toggle) {
    report.skip(step, second.list ? "the waiver view's toggle: it has one list, so no toggle" : "the waiver view's toggle: it shows no list (the season may be over for your team)");
  } else {
    const labels = toggle.map((b) => b.label);
    const kind = waiverToggleKind(labels);
    const small = toggle.filter((b) => b.height < 43.5 || b.width < 24);
    report.check(
      step,
      kind !== null && small.length === 0,
      `its toggle reads ${labels.map((l) => `“${l}”`).join(", ")}${kind === "three" ? " (a week under way with games left)" : ""}, each button at least 44 px tall`,
      kind === null ? `its toggle reads ${labels.map((l) => `“${l}”`).join(", ")}` : `${pl(small.length, "toggle button")} under 44 px tall or 24 px wide`,
      toggle.map((b) => `${b.label}: ${b.width} × ${b.height}, aria-pressed ${b.pressed ?? "missing"}`),
    );
    const was = toggle.findIndex((b) => b.pressed === "true");
    const target = was === 0 ? 1 : 0;
    let flipped = false;
    let restored = false;
    if (was >= 0 && toggle.length > 1) {
      await page.click(waiverToggle(target), `the toggle's “${labels[target] ?? ""}”`);
      flipped = await page.waitFor<boolean>(togglePressed(target), 5_000, "the toggle to follow the tap").catch(() => false);
      await page.click(waiverToggle(was), `the toggle's “${labels[was] ?? ""}”`);
      restored = await page.waitFor<boolean>(togglePressed(was), 5_000, "the toggle to follow the tap back").catch(() => false);
    }
    report.check(
      step,
      flipped && restored,
      `tapping “${labels[target] ?? ""}” moves aria-pressed to it, and tapping “${labels[was] ?? ""}” moves it back`,
      was < 0 ? "none of the toggle's buttons is pressed (aria-pressed)" : !flipped ? `tapping “${labels[target] ?? ""}” didn't move aria-pressed to it` : `tapping “${labels[was] ?? ""}” didn't move aria-pressed back`,
    );
  }

  // "Show all N" (more rows above the fold than show at first; since Checkpoint 7f N counts the rows above the fold: those
  // that help, then since its review the moves that can't be made): aria-expanded flips, and all N show; "Show fewer" folds
  // them again.
  const listed = await page.run<WaiversRead>(READ_WAIVERS);
  const more = listed.more ?? null;
  if (!more) {
    const above = listed.rows ?? 0;
    report.skip(step, above ? `“Show all”: ${pl(above, "row")} above the fold, all shown` : "“Show all”: no row above the fold, so there's nothing to show all of");
  } else {
    const total = /^Show all (\d+)$/.exec(more.text);
    await page.click(WAIVER_SHOW_ALL, `“${more.text}”`);
    await sleep(400);
    const open = await page.run<WaiversRead>(READ_WAIVERS);
    await page.click(WAIVER_SHOW_ALL, `“${open.more?.text ?? "Show fewer"}”`);
    await sleep(400);
    const closed = await page.run<WaiversRead>(READ_WAIVERS);
    const n = total ? Number(total[1]) : null;
    report.check(
      step,
      n !== null && more.expanded === "false" && more.height >= 43.5 && open.more?.expanded === "true" && open.more.text === "Show fewer" && open.rows === n && closed.more?.expanded === "false" && closed.more.text === more.text,
      `“${more.text}” shows all ${n ?? "?"} rows above the fold (aria-expanded true), and “Show fewer” folds them again`,
      `“${more.text}” doesn't open and close the list as it should`,
      [
        `before: “${more.text}”, aria-expanded ${more.expanded ?? "missing"}, ${listed.rows ?? 0} rows, ${more.height} px tall`,
        `after a tap: “${open.more?.text ?? "(gone)"}”, aria-expanded ${open.more?.expanded ?? "missing"}, ${open.rows ?? 0} rows`,
        `after another: “${closed.more?.text ?? "(gone)"}”, aria-expanded ${closed.more?.expanded ?? "missing"}, ${closed.rows ?? 0} rows`,
      ],
    );
  }
  layoutChecks(ctx, step, await page.run<Measure>(`return measure(document.getElementById("waivers"));`), "the waiver view");
  await screenshot(ctx, "05b-waivers");
  // Checkpoint 7g (item 5): the whole League page and Waiver upgrades on its own, rated, on "Rest of season", nothing unfolded
  // (shots.ts; nothing with --no-shots).
  await leagueShots(ctx, step);
}

// ---------------------------------------------------------------------------------------------
// 7. Settings

const MAX_LEGEND = "Most players per side";

/**
 * "What does your league reward?" and its three answers (planner reply to Checkpoint 7a, 5.2; "Several prizes" in place of
 * "Top finishers too" since Checkpoint 7c, planner reply to Checkpoint 7b, §6).
 */
export const GOAL_LEGEND = "What does your league reward?";
export const GOAL_CHOICES = ["Only the champion", "Several prizes", "Making the playoffs"] as const;

/**
 * The Settings page's scoring questions: "What does your league reward?" with the planner's three answers and the bubble
 * hint (5.2), and "Protect my trade value" explained without a number (§2 question 5: no exchange rate between trade value
 * and points; redraft leagues only).
 */
export async function settingsScoringChecks(ctx: StepContext, step: string): Promise<void> {
  const { page, report } = ctx;
  const r = await page.run<{ goal: { labels: string[]; help: string | null } | null; protect: { help: string | null } | null; legends: string[] }>(READ_SETTINGS_SCORING);
  const g = r.goal;
  const labelsOk = !!g && g.labels.length === GOAL_CHOICES.length && GOAL_CHOICES.every((c, i) => g.labels[i] === c);
  const hint = !!g?.help && g.help.includes("On the bubble?") && g.help.includes("It already counts getting into the playoffs.");
  report.check(
    step,
    labelsOk && hint,
    `“${GOAL_LEGEND}” offers ${GOAL_CHOICES.map((c) => `“${c}”`).join(", ")}, with the bubble hint`,
    !g ? `no “${GOAL_LEGEND}” question (the page's questions: ${r.legends.join("; ")})` : !labelsOk ? `“${GOAL_LEGEND}” offers ${g.labels.map((l) => `“${l}”`).join(", ")}` : "its help lacks the planner's hint (“On the bubble? Keep “Only the champion.” It already counts getting into the playoffs.”)",
  );
  if (!r.protect) report.skip(step, "“Protect my trade value”: not on this page (redraft leagues only)");
  else report.check(step, !!r.protect.help && !/\d/.test(r.protect.help), "“Protect my trade value” explains itself without a number", r.protect.help ? `“Protect my trade value”'s help has a number: “${r.protect.help}”` : "“Protect my trade value” has no help text");
}

/** The goal's answer for a radio value, as the page names it (settingsView.ts GOAL_LABEL); the value itself when unknown. */
const goalWords = (value: string): string => ((GOALS as readonly string[]).includes(value) ? GOAL_LABEL[value as (typeof GOALS)[number]] : value);

/**
 * "Your league's prizes" (Checkpoint 7c; planner reply to Checkpoint 7b, §6; the file header): "Several prizes" chosen
 * (when it isn't already), the group as it should read for the saved amounts (contracts.ts prizeGroupProblems: the
 * planner's five prizes and helper line, 44 px fields with the saved amounts, the app's own split line, the goal's group
 * still holding its three answers); a new amount in "1st place" saved with Enter, the split following; text "2nd place"
 * can't read said (aria-invalid and its message, in a live region) and not saved; then, with "Several prizes" still saved,
 * the odds lines on the League page, the Trade Finder and the Analyzer (prizeOddsChecks), and back on the Settings page the
 * answer it had chosen again. Runs after the playoff weight's check (each change rebuilds the League model in the page's
 * worker, which would move that line). False when the Settings page didn't open again after the odds lines (the rest of
 * the step can't run).
 */
export async function settingsPrizeChecks(ctx: StepContext, step: string): Promise<boolean> {
  const { page, report } = ctx;
  const was = await page.run<string | null>(`return ${CHECKED_GOAL};`);
  if (was !== "prizes") await page.click(goalChoice("prizes"), `“${GOAL_LABEL.prizes}”`);
  const shown = await page.waitFor<boolean>(`${CHECKED_GOAL} === "prizes" && !!byText("legend", "Your league's prizes")`, 10_000, "the league's prizes").catch(() => false);
  const back = async () => {
    if (!was || was === "prizes") return;
    await page.click(goalChoice(was), `“${goalWords(was)}”`);
    await page.waitFor<boolean>(`${CHECKED_GOAL} === ${JSON.stringify(was)} && !byText("legend", "Your league's prizes")`, 10_000, "the answer it had").catch(() => false);
  };
  if (!report.check(step, shown, `“${GOAL_LABEL.prizes}” shows the league's prizes`, `choosing “${GOAL_LABEL.prizes}” didn't show “Your league's prizes”`)) {
    await back();
    return true;
  }
  // The group as it should read for the saved amounts (the store's, read as the app reads them).
  await page.waitFor<boolean>(`((s) => !!s && s.goal === "prizes")(await savedSettings(tabLeague()))`, 10_000, "“Several prizes” to save").catch(() => false);
  const league = await readPrizeLeague(ctx);
  const saved = normalizeTradeSettings(league?.settings ?? null);
  const read = await page.run<{ group: PrizeGroupRead | null; goalLabels: number }>(READ_SETTINGS_PRIZES);
  const want = {
    labels: PRIZE_KEYS.map((k) => PRIZE_LABEL[k]),
    help: PRIZES_HELP,
    values: PRIZE_KEYS.map((k) => prizeAmountText(saved.prizes[k])),
    split: expectedPrizeSplit(saved, league?.snapshot ?? null),
  };
  const problems = prizeGroupProblems(read.group, want);
  report.check(
    step,
    problems.length === 0,
    `“Your league's prizes” shows the planner's five prizes and helper line, 44 px fields reading the saved amounts, and the split (“${read.group?.split ?? read.group?.warning ?? ""}”)`,
    "“Your league's prizes” doesn't read as it should",
    problems,
  );
  // Its fields at 375 px: none past the right edge, every one 44 px tall.
  layoutChecks(ctx, step, await page.run<Measure>(`const l = byText("legend", "Your league's prizes"); return measure(l ? l.closest("fieldset") : null);`), "the league's prizes");

  // Enter saves a new amount, and the split follows it.
  const first = PRIZE_LABEL.first;
  const amount = saved.prizes.first === 50 ? 55 : 50;
  const typed = await page.run<boolean>(typePrize(first, String(amount), "enter"));
  const savedFirst = typed && (await page.waitFor<boolean>(`((s) => !!s && !!s.prizes && s.prizes.first === ${amount})(await savedSettings(tabLeague()))`, 10_000, "the prize to save").catch(() => false));
  await sleep(300);
  const after = await page.run<{ group: PrizeGroupRead | null }>(READ_SETTINGS_PRIZES);
  const split = expectedPrizeSplit({ ...saved, prizes: { ...saved.prizes, first: amount } }, league?.snapshot ?? null);
  report.check(
    step,
    savedFirst && after.group?.split === split,
    `typing ${amount} in “${first}” and pressing Enter saves it, and the split follows (“${after.group?.split ?? ""}”)`,
    !typed ? `there's no “${first}” field to type in` : savedFirst ? `after the save the split reads “${after.group?.split ?? "nothing"}”, not “${split ?? "nothing"}”` : `Enter didn't save “${first}”`,
  );

  // Text a field can't read: it says why, and nothing is saved.
  const second = PRIZE_LABEL.second;
  await page.run<boolean>(typePrize(second, "abc", "blur"));
  await sleep(300);
  const bad = await page.run<{ group: PrizeGroupRead | null }>(READ_SETTINGS_PRIZES);
  const kept = await page.run<boolean>(`return ((s) => !!s && !!s.prizes && s.prizes.second === ${JSON.stringify(saved.prizes.second)})(await savedSettings(tabLeague()));`);
  const badProblems = [...invalidPrizeProblems(bad.group?.fields.find((f) => f.label === second), PRIZE_TEXT_MESSAGES.notNumber), ...(kept ? [] : ["the saved amount changed anyway"])];
  report.check(
    step,
    badProblems.length === 0,
    `text “${second}” can't read says why (aria-invalid, “${PRIZE_TEXT_MESSAGES.notNumber}” in a live region) and isn't saved`,
    `“${second}” took text it can't read, or didn't say why`,
    badProblems,
  );

  // The odds lines while "Several prizes" is saved (review of the prizes UI, prizes-ui-1), then the answer the page had.
  if (!(await prizeOddsChecks(ctx, step))) return false;
  await back();
  return true;
}

/**
 * The top-N odds line where the saved split shows it (Checkpoint 7c; review of the prizes UI, prizes-ui-1: the League,
 * Trade Finder and Analyzer steps run in a fresh browser under "Only the champion", so they only ever saw it absent). With
 * "Several prizes" saved (settingsPrizeChecks: the prefilled 3rd place paid), my odds on the League page (the League model
 * built again under it), the Trade Finder's cards and Plan B boxes (the search the new setting starts) and the Analyzer's
 * card for the first idea, each as the saved settings call for (myOddsChecks, cardOddsChecks: "Top 3 odds" there); then
 * the Settings page again. Each page only when the run reached it before: the League page built (ctx.leagueReady), a team
 * picked and an idea found (ctx.firstCard). True once the Settings page shows again. ⚠️ A top-N line needs every part of
 * it known (never a partial sum), so in a league whose title odds are unknown it reads as missing.
 */
async function prizeOddsChecks(ctx: StepContext, step: string): Promise<boolean> {
  const { page, report } = ctx;
  const under = `under “${GOAL_LABEL.prizes}”`;
  if (!ctx.leagueReady) {
    report.skip(step, `${under}, the odds lines: the League page didn't load in this run`);
    return true;
  }
  await page.click(`navLink("/league")`, "the nav's League link");
  const league = await page.waitFor<string>(LEAGUE_READY, 180_000, "the League page", 250).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't load"}`);
  if (report.check(step, league === "ready", `${under}, the League page built again`, `${under}, the League page didn't load: ${league.replace(/^error: /, "")}`)) {
    await myOddsChecks(ctx, step, under);
    // Checkpoint 7h: the rated waiver rows' odds lines (steps7h.ts).
    await waiverPrizeOddsChecks(ctx, step, under);
  }
  if (!ctx.myTeam || !ctx.firstCard) {
    report.skip(step, `${under}, the cards' odds lines: ${ctx.myTeam ? "the Trade Finder found no idea in this run" : "no team picked"}`);
  } else {
    await page.click(`navLink("/trades")`, "the nav's Trades link");
    const finder = await page.waitFor<string>(FINDER_DONE, 120_000, "the Trade Finder's search", 50).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
    if (report.check(step, finder === "done", `${under}, the Trade Finder searched again`, `${under}, the Trade Finder's search didn't finish: ${finder.replace(/^error: /, "")}`)) {
      if (!(await page.run<number>(`return document.querySelectorAll("main article").length;`))) {
        report.skip(step, `${under}, the cards' odds lines: the search found no idea`);
      } else {
        await cardOddsChecks(ctx, step, (i) => `idea ${i + 1}`, under);
        if (!(await page.run<boolean>(`return !!ownAnalyzerLink(document.querySelector("article"));`, { cards: true }))) {
          report.skip(step, `${under}, the Analyzer's card: the first idea has no “Open in Analyzer” link`);
        } else {
          await openCardPanel(page, `document.querySelector("article")`, "Details");
          await page.click(`ownAnalyzerLink(document.querySelector("article"))`, "Open in Analyzer");
          const state = await page.waitFor<string>(ANALYZER_DONE, 120_000, "the evaluation", 50).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't finish"}`);
          const why = state === "illegal" ? "the Analyzer says the first idea can't be made" : `the Analyzer's evaluation didn't finish: ${state.replace(/^error: /, "")}`;
          if (report.check(step, state === "evaluated", `${under}, the Analyzer evaluated the first idea`, `${under}, ${why}`)) {
            await cardOddsChecks(ctx, step, () => "the Analyzer's card", under);
            // Checkpoint 7h: the Analyzer's "What if" too (steps7h.ts).
            await whatIfPrizeOddsChecks(ctx, step, under);
          }
        }
      }
    }
  }
  await page.click(`navLink("/settings")`, "the nav's Settings link");
  const again = await page.waitFor<boolean>(`location.pathname === "/settings" && !!byText("legend", ${JSON.stringify(MAX_LEGEND)})`, 60_000, "the Settings page").catch(() => false);
  return report.check(step, again, `${under}, back on the Settings page after the odds lines`, "the Settings page didn't open again after the odds lines");
}

/**
 * The automatic playoff weight (planner reply to Checkpoint 7a, §6.1), read-only: "Playoff weeks count:" goes from "Working
 * it out…" to "N.N×, set automatically from your odds." (or the default with its reason) within about 15 s of showing,
 * N.N in [0.5, 4]; worked out by the Settings page's own engine worker from saved data: no request to ESPN, Sleeper or any
 * other site. `from`: the in-page mark taken before the page opened (WATCH_PLAYOFF_WEIGHT was installed then).
 */
export async function playoffWeightCheck(ctx: StepContext, step: string, from: number): Promise<void> {
  const { page, report } = ctx;
  await page.waitFor(PLAYOFF_WEIGHT_SHOWN, 20_000, "the playoff weight").catch(() => null);
  const seen = await page.run<Array<{ t: number; v: string }>>(STOP_PLAYOFF_WEIGHT);
  const reads = seen.map((s) => ({ ...s, ...playoffWeightRead(s.v) }));
  const first = reads[0];
  const last = reads.at(-1);
  if (!first || !last) {
    report.fail(step, "the Settings page has no “Playoff weeks count:” line");
    return;
  }
  const timeline = reads.map((r) => `${seconds(r.t - first.t)} s: ${r.v}`);
  const took = seconds(last.t - first.t);
  const working = reads.some((r) => r.state === "working");
  if (last.state === "auto" || last.state === "default") {
    const w = last.weight ?? Number.NaN;
    const inRange = w >= PLAYOFF_WEIGHT_RANGE[0] && w <= PLAYOFF_WEIGHT_RANGE[1];
    report.note(step, "playoffWeight", last.v);
    report.check(
      step,
      inRange && took <= 15,
      `“Playoff weeks count:” ${working ? `went from “Working it out…” to “${last.v}” in ${took} s` : `reads “${last.v}”`}`,
      !inRange ? `the playoff weight in “${last.v}” is outside ${PLAYOFF_WEIGHT_RANGE[0]}–${PLAYOFF_WEIGHT_RANGE[1]}×` : `the playoff weight took ${took} s to work out (about 15 s at most)`,
      timeline,
    );
  } else if (last.state === "waiting" && !ctx.leagueReady) {
    report.skip(step, "“Playoff weeks count:” waits for the League page, which didn't load in this run");
  } else {
    report.fail(step, last.state === "working" ? "“Playoff weeks count:” still reads “Working it out…” after 20 s" : `“Playoff weeks count:” reads “${last.v}”`, timeline);
  }
  const engine = await page.run<EngineAnswer[]>(`return engineSince(${from});`);
  const built = engine.filter((e) => e.type === "league").length;
  const outside = page.eventsOf(step).filter((e) => e.kind === "platform read" || e.kind === "platform failure" || e.kind === "other host");
  report.check(
    step,
    outside.length === 0,
    `the Settings page's own engine worker (${pl(built, "League model")} built) asked ESPN, Sleeper and every other site nothing`,
    `${pl(outside.length, "request")} left the site while the Settings page worked out the playoff weight`,
    outside.map((e) => `${e.kind} (${e.where}): ${e.text}`),
  );
}

export async function settingsStep(ctx: StepContext): Promise<void> {
  const step = "Settings";
  const { page, report } = ctx;
  page.step = step;
  // Phase 7b: every value the playoff weight's line takes is recorded from before the page opens (the watcher survives
  // the client-side navigation), so a brief "Working it out…" is seen too.
  await page.run(WATCH_PLAYOFF_WEIGHT);
  const from = await mark(page);
  await page.click(`navLink("/settings")`, "the nav's Settings link");
  const ready = await page
    .waitFor<string>(`location.pathname === "/settings" && (noImport() ? "no import" : byText("legend", ${JSON.stringify(MAX_LEGEND)}) ? "ready" : null)`, 60_000, "the Settings page")
    .catch(() => "no answer");
  if (!report.check(step, ready === "ready", "the Settings page opened", ready === "no import" ? "the Settings page says no league is imported" : "the Settings page didn't open (its players-per-side choice is missing)")) {
    await page.run(STOP_PLAYOFF_WEIGHT).catch(() => undefined);
    return;
  }
  await sleep(400);
  layoutChecks(ctx, step, await measurePage(ctx));
  await screenshot(ctx, "06-settings");
  await settingsScoringChecks(ctx, step);
  await playoffWeightCheck(ctx, step, from);
  // Checkpoint 7c: "Several prizes" and the league's prizes (after the playoff weight: each change rebuilds it), with the
  // odds lines on the other pages while it's saved; the rest needs the Settings page back.
  if (!(await settingsPrizeChecks(ctx, step))) return;

  // This league's saved settings in the league store, as a list of none or one (an expression for an async body).
  const stored = `[await savedSettings(tabLeague())].filter(Boolean)`;
  const option = (n: number) => `[...byText("legend", ${JSON.stringify(MAX_LEGEND)}).closest("fieldset").querySelectorAll("label")].find((l) => txt(l).startsWith(${JSON.stringify(String(n))}))`;
  const alreadyThree = await page.run<boolean>(`return ${stored}.some((s) => s && s.maxPerSide === 3);`);
  await page.click(option(alreadyThree ? 2 : 3), "a players-per-side choice");
  const want = alreadyThree ? 2 : 3;
  const saved = await page
    .waitFor<boolean>(`statusLines().some((t) => t.startsWith("Saved")) && ${stored}.some((s) => s && s.maxPerSide === ${want})`, 10_000, "the setting to save")
    .catch(() => false);
  let reset = false;
  if (saved) {
    const hasReset = await page.run<boolean>(`return !!byText("button", "Reset to defaults");`);
    if (hasReset) {
      await page.click(`byText("button", "Reset to defaults")`, "Reset to defaults");
      reset = await page.waitFor<boolean>(`!${stored}.some((s) => s && s.maxPerSide === ${want} && ${want} !== 2)`, 5_000, "the reset").catch(() => false);
    }
  }
  report.check(step, saved && reset, `a setting (${MAX_LEGEND}: ${want}) saves in this browser, and Reset to defaults clears it`, saved ? "Reset to defaults didn't clear the saved setting" : "the setting wasn't saved");
}

// ---------------------------------------------------------------------------------------------
// 8. A second league (--second-league)

/** The switcher's panel while it's open (its button's aria-controls), else null. */
const PANEL = `(() => { const b = switcherButton(); const id = b && b.getAttribute("aria-controls"); return id ? document.getElementById(id) : null; })()`;

/** Opens the switcher's panel (the button pressed when it's closed); false when it doesn't open. */
async function openSwitcher(page: PageSession): Promise<boolean> {
  if (!(await page.run<boolean>(`return !!switcherButton();`))) return false;
  if (!(await page.run<boolean>(`return !!(${PANEL});`))) await page.click(`switcherButton()`, "the league switcher");
  return page.waitFor<boolean>(`!!(${PANEL})`, 5_000, "the league switcher's panel").catch(() => false);
}

/** Closes the switcher's panel (its button pressed again). */
async function closeSwitcher(page: PageSession): Promise<void> {
  if (await page.run<boolean>(`return !!(${PANEL});`)) await page.click(`switcherButton()`, "the league switcher");
  await page.waitFor<boolean>(`!(${PANEL})`, 5_000, "the league switcher's panel to close").catch(() => false);
}

/** Switches the tab to a saved league (its id) with the switcher; true once the tab shows it. */
async function switchLeague(page: PageSession, id: string): Promise<boolean> {
  if (!(await openSwitcher(page))) return false;
  await page.click(`(${PANEL}).querySelector(${JSON.stringify(`[data-league-id="${id}"]`)})`, "a league in the switcher");
  return page.waitFor<boolean>(`tabLeague() === ${JSON.stringify(id)} && !(${PANEL})`, 10_000, "the switch").catch(() => false);
}

/** Whether the page's main heading shows a saved league's own name (compared in the page, never returned). */
const headingShows = (id: string) => `showsName(document.querySelector("main h1"), await savedImport(${JSON.stringify(id)}))`;

/** The Settings page's league card title (the h2 under its "League" eyebrow) shows a saved league's own name. */
const settingsShows = (id: string) =>
  `showsName([...document.querySelectorAll("main h2")].find((h) => { const p = h.previousElementSibling; return p && txt(p) === "League"; }) || null, await savedImport(${JSON.stringify(id)}))`;

/** The players-per-side choice checked on the Settings page ("2", "3"…), or null. */
const CHECKED_MAX = `(() => { const l = byText("legend", ${JSON.stringify(MAX_LEGEND)}); const r = l ? l.closest("fieldset").querySelector("input[type=radio]:checked") : null; return r ? r.value : null; })()`;

export async function secondLeagueStep(ctx: StepContext): Promise<void> {
  const step = "Second league";
  const { page, report } = ctx;
  page.step = step;
  if (!ctx.args.secondLeague) {
    report.skip(step, "not asked for (npm run check:browser -- --live --second-league adds a second league and switches between them)");
    return;
  }
  if (!ctx.names) {
    report.skip(step, "no league imported");
    return;
  }
  // The first league's saved id, kept here to compare (never printed).
  const first = await page.run<string | null>(`return tabLeague();`);
  if (!first) {
    report.fail(step, "the tab doesn't say which saved league it shows (sessionStorage offersheet:current-league:v1)");
    return;
  }

  // 1. An outcome on the first league's first idea, to show feedback stays with its league.
  const sentButton = `[...document.querySelector("article").querySelectorAll("div[role=group] button")].find((b) => visibleText(b).replace("✓", "").trim() === "Sent")`;
  let sent = false;
  if (ctx.firstCard) {
    await page.click(`navLink("/trades")`, "the nav's Trades link");
    const shown = await page.waitFor<string>(FINDER_DONE, 120_000, "the Trade Finder", 50).catch(() => "no");
    if (shown === "done") {
      await openCardPanel(page, `document.querySelector("article")`, "Details");
      await page.click(sentButton, "the Sent button");
      const chooser = `[...document.querySelector("article").querySelectorAll("fieldset")].find((f) => /^Which version/.test(txt(f.querySelector("legend") || f)))`;
      const asked = await page.waitFor<boolean>(`(() => { const b = ${sentButton}; return (b && b.getAttribute("aria-pressed") === "true") || !!(${chooser}); })()`, 5_000, "Sent to save or to ask which version").catch(() => false);
      if (asked && (await page.run<boolean>(`return !!(${chooser});`))) await page.click(`[...(${chooser}).querySelectorAll("button")][0]`, "the first version offered");
      sent = await page
        .waitFor<boolean>(`(await savedFeedback(${JSON.stringify(first)})).some((r) => r.outcome && r.outcome.kind === "sent")`, 5_000, "Sent to save")
        .catch(() => false);
    }
    report.check(step, sent, "an outcome (Sent) on the first league's first idea is saved with that league", "Sent on the first league's first idea wasn't saved");
  } else {
    report.skip(step, "the first league has no trade idea: the feedback check is left out");
  }

  // 2. The second league, through the switcher's "Add league" and the Connect page's public-link import.
  if (!(await openSwitcher(page))) {
    report.fail(step, "the league switcher isn't at the top of the page, or its panel doesn't open");
    return;
  }
  await page.click(`[...(${PANEL}).querySelectorAll("a")].find((a) => txt(a) === "Add league")`, "Add league");
  await page.waitFor(`location.pathname === "/connect" && document.getElementById("espn-league")`, 30_000, "the Connect page");
  await page.run(`setInput(document.getElementById("espn-league"), ${JSON.stringify(SECOND_LEAGUE.leagueId)}); return true;`);
  const season = await page.run<boolean>(`
    const s = document.getElementById("espn-season");
    if (!s || ![...s.options].some((o) => o.value === ${JSON.stringify(SECOND_LEAGUE.season)})) return false;
    if (s.value !== ${JSON.stringify(SECOND_LEAGUE.season)}) setSelect(s, ${JSON.stringify(SECOND_LEAGUE.season)});
    return true;
  `);
  if (!season) report.note(step, "season", "the test league's season isn't one of the Connect page's seasons: its default was used");
  await page.waitFor<boolean>(`[...document.querySelectorAll("span")].some((e) => /^League \\d+$/.test(txt(e)))`, 10_000, "the test league's id to be recognized").catch(() => false);
  const started = Date.now();
  await page.click(`[...document.querySelectorAll("button[type=submit]")].find((b) => txt(b).includes("Import"))`, "the Import button");
  const imported = await page
    .waitFor<string>(
      `(await (async () => { if (location.pathname === "/import" && document.getElementById("my-team") && tabLeague() && tabLeague() !== ${JSON.stringify(first)}) return "ok"; const e = [...document.querySelectorAll("[role=alert], .text-danger-fg")].map(txt).filter((t) => t.length > 3)[0]; return e ? "error: " + e : null; })())`,
      240_000,
      "the test league's import",
      250,
    )
    .catch((err: unknown) => `error: ${err instanceof Error ? err.message : "the import didn't finish"}`);
  report.note(step, "importSeconds", seconds(Date.now() - started));
  if (imported !== "ok") {
    report.fail(step, `the test league didn't import: ${imported.replace(/^error: /, "")}`);
    return;
  }
  const second = (await page.run<string | null>(`return tabLeague();`)) as string;
  // Its names join the cleaning before anything else is read from the page.
  const secondNames = await page.run<LeagueNames | null>(`return namesOf(await savedImport(${JSON.stringify(second)}));`);
  if (!secondNames) {
    report.fail(step, "the test league isn't saved in this browser");
    return;
  }
  ctx.names = mergeLeagueNames(ctx.names, secondNames, "L2-");
  ctx.onNames(ctx.names);
  report.ok(step, `imported the test league through "Add league" (now ${pl((await page.run<string[]>(`return await savedLeagueIds();`)).length, "saved league")})`);
  // Phase 7b (§5.1): another league's data, the same contract, once the report has shown what it reads after its first
  // render (as in the Import Report step).
  await settle(page);
  await importNoticeChecks(ctx, step, { parkers: false, where: "the test league's Import Report" });

  // 3. The second league on every page.
  report.check(step, await page.run<boolean>(`return ${headingShows(second)};`), "the Import Report shows the test league", "the Import Report doesn't show the test league's name");
  if (await openSwitcher(page)) {
    const listed = await page.run<{ count: number; currentIsSecond: boolean; firstListed: boolean; m: Measure }>(`
      const panel = ${PANEL};
      const items = [...panel.querySelectorAll("[data-league-id]")];
      const current = items.filter((b) => b.getAttribute("aria-current") === "true");
      return { count: items.length, currentIsSecond: current.length === 1 && current[0].dataset.leagueId === ${JSON.stringify(second)}, firstListed: items.some((b) => b.dataset.leagueId === ${JSON.stringify(first)}), m: measure(panel) };
    `);
    report.check(
      step,
      listed.count === 2 && listed.currentIsSecond && listed.firstListed,
      "the switcher lists both leagues, the test league marked as the one shown",
      `the switcher lists ${pl(listed.count, "league")}${listed.currentIsSecond ? "" : ", the test league not marked as shown"}${listed.firstListed ? "" : ", without the first league"}`,
    );
    report.check(step, listed.m.smallCount === 0, `the switcher's panel: tap targets at least 44 px tall (${listed.m.targets} checked)`, `${pl(listed.m.smallCount, "tap target")} in the switcher's panel under 44 px`, listed.m.small);
    layoutChecks(ctx, step, await measurePage(ctx), "the page with the switcher open");
    await screenshot(ctx, "07-switcher");
    await closeSwitcher(page);
  } else {
    report.fail(step, "the league switcher's panel doesn't open");
  }

  await page.click(`navLink("/league")`, "the nav's League link");
  const league2 = await page.waitFor<string>(LEAGUE_READY, 400_000, "the test league's League page", 250).catch((err: unknown) => `error: ${err instanceof Error ? err.message : "it didn't load"}`);
  if (report.check(step, league2 === "ready", "the League page built the test league", `the test league's League page didn't load: ${league2.replace(/^error: /, "")}`)) {
    report.check(step, await page.run<boolean>(`return ${headingShows(second)};`), "the League page shows the test league", "the League page doesn't show the test league's name");
    await leagueNoticeChecks(ctx, step, { parkers: false, where: "the test league's League page" });
  }
  await page.click(`navLink("/trades")`, "the nav's Trades link");
  const finder2 = await page
    .waitFor<string>(`location.pathname === "/trades" && (noImport() ? "no import" : txt(document.querySelector("main") || document.body).includes("Pick your team on the Import Report to see trade ideas.") ? (document.querySelectorAll("article").length ? "cards" : "asks") : null)`, 120_000, "the test league's Trade Finder")
    .catch(() => "no answer");
  report.check(step, finder2 === "asks", "the Trade Finder asks for the test league's team, with none of the first league's ideas", `the Trade Finder in the test league: ${finder2}`);
  await page.click(`[...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/analyzer")`, "the Trade Analyzer link");
  const analyzer2 = await page
    .waitFor<string>(`location.pathname === "/analyzer" && (noImport() ? "no import" : txt(document.querySelector("main") || document.body).includes("Pick your team on the Import Report to build trades.") ? "asks" : null)`, 60_000, "the test league's Trade Analyzer")
    .catch(() => "no answer");
  report.check(step, analyzer2 === "asks", "the Trade Analyzer asks for the test league's team too", `the Trade Analyzer in the test league: ${analyzer2}`);

  await page.click(`navLink("/settings")`, "the nav's Settings link");
  const settings2 = await page.waitFor<boolean>(`location.pathname === "/settings" && !!byText("legend", ${JSON.stringify(MAX_LEGEND)})`, 60_000, "the test league's Settings page").catch(() => false);
  if (report.check(step, settings2 && (await page.run<boolean>(`return ${settingsShows(second)};`)), "the Settings page shows the test league's settings", "the Settings page doesn't show the test league")) {
    const firstMax = await page.run<number | null>(`const s = await savedSettings(${JSON.stringify(first)}); return s ? s.maxPerSide : null;`);
    const want = firstMax === 3 ? 2 : 3;
    await page.click(
      `[...byText("legend", ${JSON.stringify(MAX_LEGEND)}).closest("fieldset").querySelectorAll("label")].find((l) => txt(l).startsWith(${JSON.stringify(String(want))}))`,
      "a players-per-side choice",
    );
    const own = await page
      .waitFor<boolean>(
        `(await (async () => { const a = await savedSettings(${JSON.stringify(second)}); const b = await savedSettings(${JSON.stringify(first)}); return !!a && a.maxPerSide === ${want} && (b ? b.maxPerSide : null) === ${JSON.stringify(firstMax)}; })())`,
        10_000,
        "the test league's setting to save",
      )
      .catch(() => false);
    report.check(step, own, `a setting saved in the test league (${MAX_LEGEND}: ${want}) is its own: the first league's stays as it was`, "the test league's setting wasn't saved as its own");
  }
  if (sent) {
    const feedback = await page.run<{ second: number; first: boolean }>(
      `return { second: (await savedFeedback(${JSON.stringify(second)})).length, first: (await savedFeedback(${JSON.stringify(first)})).some((r) => r.outcome && r.outcome.kind === "sent") };`,
    );
    report.check(step, feedback.second === 0 && feedback.first, "feedback stays per league: none in the test league, the first league's Sent kept", `feedback isn't per league (${feedback.second} record(s) in the test league; the first league's Sent ${feedback.first ? "kept" : "gone"})`);
  }

  // 4. Back to the first league: every page shows it again, with its own settings and feedback.
  if (!(await switchLeague(page, first))) {
    report.fail(step, "switching back to the first league with the switcher didn't work");
    return;
  }
  const back = await page
    .waitFor<boolean>(`location.pathname === "/settings" && ${settingsShows(first)} && ${CHECKED_MAX} !== null`, 30_000, "the first league's settings")
    .catch(() => false);
  const backMax = back ? await page.run<string | null>(`return ${CHECKED_MAX};`) : null;
  const firstSaved = await page.run<number | null>(`const s = await savedSettings(${JSON.stringify(first)}); return s ? s.maxPerSide : null;`);
  report.check(
    step,
    back && backMax === String(firstSaved ?? 2),
    `switched back with the switcher: the Settings page shows the first league's own settings (${MAX_LEGEND}: ${backMax})`,
    back ? `the Settings page shows ${MAX_LEGEND}: ${backMax} for the first league` : "the Settings page doesn't show the first league after switching back",
  );
  await page.click(`navLink("/import")`, "the nav's Import report link");
  const report1 = await page.waitFor<boolean>(`location.pathname === "/import" && !!document.getElementById("my-team") && ${headingShows(first)}`, 30_000, "the first league's Import Report").catch(() => false);
  report.check(step, report1, "the Import Report shows the first league again", "the Import Report doesn't show the first league after switching back");
  await page.click(`navLink("/league")`, "the nav's League link");
  const league1 = await page.waitFor<string>(LEAGUE_READY, 400_000, "the first league's League page", 250).catch(() => "no");
  report.check(step, league1 === "ready" && (await page.run<boolean>(`return ${headingShows(first)};`)), "the League page shows the first league again", "the League page doesn't show the first league after switching back");
  if (ctx.firstCard) {
    await page.click(`navLink("/trades")`, "the nav's Trades link");
    const finder1 = await page.waitFor<string>(FINDER_DONE, 300_000, "the first league's Trade Finder", 50).catch(() => "no");
    const pressed = finder1 === "done" ? await page.run<boolean>(`const b = ${sentButton}; return !!b && b.getAttribute("aria-pressed") === "true";`).catch(() => false) : false;
    report.check(
      step,
      finder1 === "done" && pressed === sent,
      `the Trade Finder shows the first league's ideas again${sent ? ", the first one still marked Sent" : ""}`,
      finder1 === "done" ? "the first league's first idea lost its Sent" : "the Trade Finder doesn't show the first league's ideas after switching back",
    );
  }

  // 4b. A trade page's address names teams of the league it was for (review of track ML; finderMemory.ts
  // useLeagueQuery): a partner picked on the first league's Trade Finder doesn't follow a switch to the test league.
  // (Team ids only, compared in the page and never printed.)
  let partner: string | null = null;
  if (ctx.myTeam) {
    if ((await page.run<string>(`return location.pathname;`)) !== "/trades") await page.click(`navLink("/trades")`, "the nav's Trades link");
    const ready = await page.waitFor<string>(FINDER_DONE, 300_000, "the first league's Trade Finder", 50).catch(() => "no");
    partner =
      ready === "done" ? await page.run<string | null>(`const s = document.getElementById("finder-partner"); return (s ? [...s.options].map((o) => o.value).filter(Boolean) : [])[0] || null;`) : null;
    if (partner) {
      const from = await mark(page);
      await page.run(`setSelect(document.getElementById("finder-partner"), ${JSON.stringify(partner)}); return true;`);
      const searched = await page
        .waitFor<boolean>(`location.search === ${JSON.stringify(`?partner=${partner}`)} && engineSince(${from}).some((e) => e.type === "trades") && ${FINDER_DONE} === "done"`, 120_000, "the one-partner search", 50)
        .catch(() => false);
      const switched = searched && (await switchLeague(page, second));
      const own = switched
        ? await page
            .waitFor<boolean>(`location.pathname === "/trades" && location.search === "" && txt(document.querySelector("main") || document.body).includes("Pick your team on the Import Report to see trade ideas.")`, 30_000, "the test league's Trade Finder")
            .catch(() => false)
        : false;
      report.check(
        step,
        own,
        "a partner picked on the first league's Trade Finder doesn't follow a switch: the test league's Finder opens on its own, its address without the partner",
        !searched ? "picking a partner on the first league's Trade Finder didn't search" : !switched ? "switching to the test league from the Trade Finder didn't work" : "after the switch, the address still names the first league's partner",
      );
      if (!own) partner = null;
    } else {
      report.skip(step, "the first league's Trade Finder has no partner to pick: the trade pages' address checks are left out");
    }
  } else {
    report.skip(step, "no team picked: the trade pages' address checks are left out");
  }

  // 5. Remove the test league, the league shown, from a trade page whose address names a team (written under the test
  // league, as a link would): asked first; then it and what it saved go, and nothing of the first league's; the tab moves
  // to the first league, whose Trade Finder opens for every team, never on that address's partner, and the address goes.
  if ((await page.run<string | null>(`return tabLeague();`)) !== second && !(await switchLeague(page, second))) {
    report.fail(step, "switching to the test league to remove it didn't work");
    return;
  }
  if (partner) {
    await page.run(`window.history.replaceState(null, "", "/trades?partner=" + ${JSON.stringify(partner)}); return true;`);
    await page.waitFor<boolean>(`location.search === ${JSON.stringify(`?partner=${partner}`)}`, 5_000, "the address").catch(() => false);
    await sleep(500);
    // From here on, any partner the Finder's filter shows is noted: the first league's must never show the address's.
    await page.run(`
      window.__partnersShown = [];
      const note = () => { const s = document.getElementById("finder-partner"); if (s && s.value) window.__partnersShown.push(s.value); };
      window.__partnerWatch = new MutationObserver(note);
      window.__partnerWatch.observe(document, { subtree: true, childList: true, attributes: true });
      return true;
    `);
  }
  if (!(await openSwitcher(page))) {
    report.fail(step, "the league switcher's panel doesn't open to remove the test league");
    return;
  }
  await page.click(`(${PANEL}).querySelector(${JSON.stringify(`[data-remove-league="${second}"]`)})`, "Remove on the test league");
  const asked = await page
    .waitFor<boolean>(`!!(${PANEL}) && [...(${PANEL}).querySelectorAll("[role=group] p")].some((p) => /^Remove .* from this browser\\?$/.test(txt(p))) && !!byText("button", "Yes, remove it", ${PANEL})`, 5_000, "the removal's question")
    .catch(() => false);
  if (!report.check(step, asked, "Remove asks first, saying what goes", "Remove didn't ask before removing the league")) return;
  await page.click(`byText("button", "Yes, remove it", ${PANEL})`, "Yes, remove it");
  const removed = await page
    .waitFor<boolean>(
      `(await (async () => { const ids = await savedLeagueIds(); return ids.length === 1 && ids[0] === ${JSON.stringify(first)} && tabLeague() === ${JSON.stringify(first)} && !(await savedImport(${JSON.stringify(second)})) && !(await savedSettings(${JSON.stringify(second)})); })())`,
      10_000,
      "the test league to be removed",
    )
    .catch(() => false);
  const kept = sent ? await page.run<boolean>(`return (await savedFeedback(${JSON.stringify(first)})).some((r) => r.outcome && r.outcome.kind === "sent");`) : true;
  report.check(
    step,
    removed && kept,
    "Remove deleted the test league (the league shown) and its settings; the first league and its feedback stayed, and the tab moved to it",
    removed ? "removing the test league took the first league's feedback with it" : "the test league (or its settings) is still saved after Remove, or the tab didn't move to the first league",
  );
  const named = await page.run<boolean>(`return statusLines().some((t) => t.startsWith("Removed ") && t.includes(" Now showing "));`);
  report.check(step, named, "the switcher's status line says which league shows now", "the switcher's status line doesn't say which league shows after the removal");
  if (partner) {
    const finder1 = await page.waitFor<string>(FINDER_DONE, 300_000, "the first league's Trade Finder after the removal", 50).catch(() => "no");
    const after = await page.run<{ search: string; filter: string | null; shown: number }>(`
      if (window.__partnerWatch) window.__partnerWatch.disconnect();
      const s = document.getElementById("finder-partner");
      return { search: location.search, filter: s ? s.value : null, shown: (window.__partnersShown || []).length };
    `);
    report.check(
      step,
      finder1 === "done" && after.search === "" && after.filter === "" && after.shown === 0,
      "the first league's Trade Finder opened for every team after the removal: never on the removed league's address, which is gone",
      finder1 !== "done"
        ? "the first league's Trade Finder didn't show its ideas after the removal"
        : `the first league's Trade Finder read the removed league's address (${after.search ? "the address kept it" : "address dropped"}; the filter showed a partner ${after.shown} time(s); now ${after.filter ? "a partner" : "every team"})`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 9. The public pages and the site's files

/** The pages anyone can read (Part B, B3), each checked with a full load at phone width; `h1` is its heading when it has a fixed one. */
export const STATIC_PAGES: ReadonlyArray<{ step: string; pathname: string; shot: string; h1?: string }> = [
  { step: "Home", pathname: "/", shot: "08-home" },
  { step: "Privacy", pathname: "/privacy", shot: "09-privacy", h1: "Privacy" },
  { step: "Terms", pathname: "/terms", shot: "10-terms", h1: "Terms of use" },
  { step: "Feedback", pathname: "/feedback", shot: "11-feedback", h1: "Feedback" },
];

/** An address the app doesn't have: the branded 404 page (src/app/not-found.tsx). */
export const MISSING_PAGE = { step: "Missing page", pathname: "/no-such-page", shot: "12-not-found", h1: "Page not found" } as const;

/** The missing page's own document request: the one failed request that step expects. */
export function isMissingPage404(e: Pick<PageEvent, "kind" | "text">): boolean {
  return e.kind === "failed request" && e.text === `HTTP 404 ${MISSING_PAGE.pathname}`;
}

/** What the home page's response and the site's files say (read in the page: same-origin requests only). */
export interface SiteFiles {
  csp: string | null;
  cspReportOnly: string | null;
  permissions: string | null;
  poweredBy: string | null;
  manifest: { startUrl: string | null; icons: Array<{ src: string; sizes: string; purpose: string; ok: boolean; type: string | null }> } | null;
  icons: Array<{ rel: string; href: string; ok: boolean; type: string | null }>;
  og: { ok: boolean; type: string | null; width: string | null; height: string | null; alt: boolean } | null;
  robots: string;
  sitemap: string;
}

/** The checks on the site's files and headers (pure; Part B, B3 and B4): [passed, what passed, what failed]. */
export function siteFileChecks(f: SiteFiles): Array<[boolean, string, string]> {
  const policy = f.csp?.includes("script-src") ? f.csp : f.cspReportOnly?.includes("script-src") ? f.cspReportOnly : null;
  const mode = policy !== null && policy === f.csp ? "enforced" : "report-only";
  const connect = /(?:^|;)\s*connect-src ([^;]*)/.exec(policy ?? "")?.[1]?.trim().split(/\s+/) ?? [];
  const icons = f.manifest?.icons ?? [];
  const anySizes = new Set(icons.filter((i) => i.purpose === "any").map((i) => i.sizes));
  const locs = [...f.sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => {
    try {
      return new URL(m[1] ?? "").pathname;
    } catch {
      return m[1] ?? "";
    }
  });
  return [
    [policy !== null, `the production build sends the full Content-Security-Policy (${mode})`, "the home page's response has no full Content-Security-Policy (no script-src)"],
    [
      connect.includes("'self'") && connect.includes("https://api.sleeper.app") && connect.includes("https://lm-api-reads.fantasy.espn.com"),
      "its connect-src allows the site and the two league APIs the browser reads",
      `its connect-src is "${connect.join(" ")}"`,
    ],
    [
      !!f.permissions && f.poweredBy === null,
      "a Permissions-Policy, and no X-Powered-By header",
      `Permissions-Policy ${f.permissions ? "sent" : "missing"}, X-Powered-By ${f.poweredBy === null ? "absent" : "sent"}`,
    ],
    [
      !!f.manifest && anySizes.has("192x192") && anySizes.has("512x512") && icons.some((i) => i.purpose === "maskable") && icons.every((i) => i.ok && i.type === "image/png"),
      `the manifest lists 192 and 512 px icons and a maskable one, each served as a PNG (it opens on ${f.manifest?.startUrl ?? "?"})`,
      f.manifest ? `the manifest's icons: ${icons.map((i) => `${i.src} ${i.sizes} ${i.purpose} ${i.ok ? i.type : "failed"}`).join(", ") || "none"}` : "no manifest linked, or it didn't load",
    ],
    [
      f.icons.some((i) => i.rel === "apple-touch-icon") && f.icons.some((i) => i.rel !== "apple-touch-icon") && f.icons.every((i) => i.ok && (i.type ?? "").startsWith("image/")),
      `the tab and iPhone icons load (${f.icons.length})`,
      `the icons: ${f.icons.map((i) => `${i.rel} ${i.href} ${i.ok ? i.type : "failed"}`).join(", ") || "none linked"}`,
    ],
    [
      !!f.og && f.og.ok && f.og.type === "image/png" && f.og.width === "1200" && f.og.height === "630" && f.og.alt,
      "the sharing image loads: a 1200 × 630 PNG with alt text",
      f.og ? `the sharing image: ${f.og.ok ? f.og.type : "failed"}, ${f.og.width} × ${f.og.height}, alt text ${f.og.alt ? "set" : "missing"}` : "no og:image",
    ],
    [/Disallow: \/api\//.test(f.robots) && /Sitemap: /.test(f.robots), "robots.txt keeps crawlers off /api/ and names the sitemap", "robots.txt doesn't say Disallow: /api/ and Sitemap:"],
    [["/", "/connect", "/privacy", "/terms", "/feedback"].every((p) => locs.includes(p)), "the sitemap lists the public pages", `the sitemap lists ${locs.join(", ") || "nothing"}`],
  ];
}

/** One public page: a full load, its heading, the layout, a screenshot and the health check. */
async function publicPage(ctx: StepContext, page: { step: string; pathname: string; shot: string; h1?: string }, expected?: (e: PageEvent) => boolean): Promise<void> {
  const { step } = page;
  ctx.page.step = step;
  await ctx.page.navigate(page.pathname);
  const h1 = await ctx.page.waitFor<string>(`txt(document.querySelector("main h1")) || null`, 30_000, `the ${step} page`).catch(() => null);
  if (ctx.report.check(step, h1 !== null, "the page loaded", "the page didn't load")) {
    if (page.h1) ctx.report.check(step, h1 === page.h1, `its heading reads "${page.h1}"`, `its heading reads "${h1}", not "${page.h1}"`);
    await sleep(500);
    layoutChecks(ctx, step, await measurePage(ctx));
    await screenshot(ctx, page.shot);
  }
  healthCheck(ctx, step, expected);
}

/** In the page (with PAGE_HELPERS): the home page's own headers and the site's files (see siteFileChecks). */
export const READ_SITE_FILES = `
  const get = async (url) => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      return { ok: r.ok, type: (r.headers.get("content-type") || "").split(";")[0].trim() || null, r: r };
    } catch (e) {
      return { ok: false, type: null, r: null };
    }
  };
  const home = await get("/");
  const h = home.r ? home.r.headers : new Headers();
  let manifest = null;
  const ml = document.querySelector('link[rel="manifest"]');
  if (ml) {
    const m = await get(ml.getAttribute("href"));
    const json = m.ok ? await m.r.json().catch(() => null) : null;
    if (json) {
      const icons = [];
      for (const i of json.icons || []) {
        const r = await get(i.src);
        icons.push({ src: i.src, sizes: i.sizes || "", purpose: i.purpose || "any", ok: r.ok, type: r.type });
      }
      manifest = { startUrl: json.start_url || null, icons: icons };
    }
  }
  const icons = [];
  for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
    const r = await get(l.getAttribute("href"));
    icons.push({ rel: l.getAttribute("rel"), href: l.getAttribute("href"), ok: r.ok, type: r.type });
  }
  const meta = (p) => {
    const m = document.querySelector('meta[property="' + p + '"]');
    return m ? m.getAttribute("content") : null;
  };
  let og = null;
  const ogUrl = meta("og:image");
  if (ogUrl) {
    // Its absolute URL names the site's own address (metadataBase), not this server's port: read its path here.
    const u = new URL(ogUrl, location.href);
    const r = await get(u.pathname + u.search);
    og = { ok: r.ok, type: r.type, width: meta("og:image:width"), height: meta("og:image:height"), alt: !!meta("og:image:alt") };
  }
  const text = async (url) => {
    const r = await get(url);
    return r.ok ? await r.r.text() : "";
  };
  return {
    csp: h.get("content-security-policy"),
    cspReportOnly: h.get("content-security-policy-report-only"),
    permissions: h.get("permissions-policy"),
    poweredBy: h.get("x-powered-by"),
    manifest: manifest,
    icons: icons,
    og: og,
    robots: await text("/robots.txt"),
    sitemap: await text("/sitemap.xml"),
  };
`;

export async function staticPagesStep(ctx: StepContext): Promise<void> {
  for (const page of STATIC_PAGES) await publicPage(ctx, page);
  await publicPage(ctx, MISSING_PAGE, isMissingPage404);

  const step = "Site files";
  ctx.page.step = step;
  await ctx.page.navigate("/");
  const files = await ctx.page.run<SiteFiles>(READ_SITE_FILES);
  for (const [ok, pass, fail] of siteFileChecks(files)) ctx.report.check(step, ok, pass, fail);
  healthCheck(ctx, step);

  await fantasyCalcHtmlStep(ctx);
}

/** Every app page (contracts.ts APP_PAGES since Checkpoint 7c, where npm run prod:deploy reads it too), re-exported here. */
export { APP_PAGES };

/**
 * FantasyCalc's attribution in the server's own HTML (Phase 7b; their condition 2: at least one link per page in plain
 * server-rendered HTML, not loaded by JavaScript, not hidden): each app page read straight from the server (a plain HTTP
 * GET, never the browser, so no script has run) has a link to https://fantasycalc.com in its footer, and every link to
 * FantasyCalc in it has rel exactly "noopener" and referrerpolicy "origin" (contracts.ts fantasyCalcLinksInHtml). The
 * pages need no league: the footer is the root layout's. Checkpoint 7d (planner reply to Checkpoint 7c, "Also": "Link
 * “DynastyProcess” in the footer to its data repository"), step "DynastyProcess link" from the same HTML: each page's footer
 * links "DynastyProcess" to https://github.com/dynastyprocess/data with rel "noopener" (contracts.ts dynastyProcessLinkIssues).
 */
export async function fantasyCalcHtmlStep(ctx: StepContext): Promise<void> {
  const step = "FantasyCalc links";
  const dpStep = "DynastyProcess link";
  ctx.page.step = step;
  const problems: string[] = [];
  const dpProblems: string[] = [];
  let links = 0;
  for (const pathname of APP_PAGES) {
    try {
      const res = await fetch(`${ctx.page.origin}${pathname}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
      const html = await res.text();
      if (!res.ok) {
        problems.push(`${pathname}: HTTP ${res.status}`);
        dpProblems.push(`${pathname}: HTTP ${res.status}`);
        continue;
      }
      const found = fantasyCalcLinksInHtml(html);
      links += found.length;
      problems.push(...fantasyCalcLinkIssues(found, { requireFooter: true }).map((p) => `${pathname}: ${p}`));
      dpProblems.push(...dynastyProcessLinkIssues(dynastyProcessLinksInHtml(html)).map((p) => `${pathname}: ${p}`));
    } catch (err) {
      const why = `${pathname}: ${err instanceof Error ? err.name : "the request failed"}`;
      problems.push(why);
      dpProblems.push(why);
    }
  }
  ctx.report.note(step, "linksInServerHtml", links);
  ctx.report.check(
    step,
    problems.length === 0,
    `the server's HTML of every app page (${APP_PAGES.join(", ")}) links to fantasycalc.com from its footer before any script runs, every FantasyCalc link with rel "noopener" and referrerpolicy "origin"`,
    `${pl(problems.length, "problem")} with the FantasyCalc links in the pages' server HTML`,
    problems,
  );
  ctx.report.check(
    dpStep,
    dpProblems.length === 0,
    `the server's HTML of every app page credits DynastyProcess in its footer with a link to ${DYNASTYPROCESS_DATA_URL} (rel "noopener") before any script runs`,
    `${pl(dpProblems.length, "problem")} with the footer's DynastyProcess link in the pages' server HTML`,
    dpProblems,
  );
}

export interface Step {
  name: string;
  run: (ctx: StepContext) => Promise<void>;
  health: boolean;
  /** A stop here (the import) leaves the league-bound steps after it nothing to check. */
  essential?: true;
  /** Needs no league: runs even after an essential step stopped. */
  independent?: true;
}

/**
 * The steps, in order, with the health check after each (the public pages check their own). An essential step that
 * stops (the import) leaves nothing for the league-bound steps to check: they're skipped; the public pages still run.
 */
export const STEPS: readonly Step[] = [
  { name: "Connect", run: connectStep, health: true, essential: true },
  { name: "Import Report", run: importReportStep, health: true },
  { name: "League", run: leagueStep, health: true },
  { name: "Notices", run: noticesStep, health: true },
  { name: "Trade Finder", run: finderStep, health: true },
  { name: "Trade card", run: cardStep, health: true },
  { name: "Analyzer", run: analyzerStep, health: true },
  { name: "What if", run: whatIfStep, health: true },
  { name: "Waivers", run: waiversStep, health: true },
  { name: "Thorough search", run: thoroughStep, health: true },
  { name: "Settings", run: settingsStep, health: true },
  { name: "Second league", run: secondLeagueStep, health: true },
  { name: "Public pages", run: staticPagesStep, health: false, independent: true },
];

/** Why a step is skipped (pure): the stop that came before it, unless it needs no league; null: it runs. */
export function skipReason(step: Pick<Step, "independent">, stop: string | null): string | null {
  return stop && !step.independent ? `not checked: ${stop}` : null;
}

