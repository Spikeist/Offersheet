/**
 * NFL season helpers (pure; pass the time in). A season is named by the year it starts: the 2026
 * season runs from September 2026 through the playoffs in January and February 2027.
 */

/** The first season any supported platform serves league data for through our adapters. */
export const OLDEST_SEASON = 2018;

/** Month (0-based) from which a new season is the default: March, after the Super Bowl. */
const NEW_SEASON_MONTH = 2;

/** The season a user most likely means right now: the calendar year, or last year in January–February. */
export function defaultSeason(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= NEW_SEASON_MONTH ? year : year - 1;
}

/**
 * The newest season anyone can import: the calendar year. In January and February that's next
 * season (leagues renew for it after the Super Bowl); from March on it's the default season.
 */
export function newestSeason(now: Date): number {
  return now.getUTCFullYear();
}

/** True for a whole-number season from OLDEST_SEASON through newestSeason(now). */
export function isPlausibleSeason(season: number, now: Date): boolean {
  return Number.isInteger(season) && season >= OLDEST_SEASON && season <= newestSeason(now);
}

/** The message for a season isPlausibleSeason refuses, naming exactly the range it accepts. */
export function seasonRangeMessage(now: Date): string {
  return `Pick a season from ${OLDEST_SEASON} to ${newestSeason(now)}.`;
}

/**
 * The season in a pasted link: used (and the season picker locked to it) only when it can be
 * imported; otherwise a note says why it's ignored, and the user picks one.
 */
export function seasonFromLink(linkSeason: number | undefined, now: Date): { season?: number; note?: string } {
  if (linkSeason === undefined) return {};
  if (isPlausibleSeason(linkSeason, now)) return { season: linkSeason };
  return { note: `Your link is for the ${linkSeason} season, but Offer Sheet covers ${OLDEST_SEASON} to ${newestSeason(now)}. Pick a season below.` };
}
