/**
 * Reads what a user types into the Sleeper fields on the Connect page (pure, client-safe; the
 * server runs the same checks): a league ID or a pasted sleeper.com league link, and a username.
 */

export type SleeperLeagueInput = { ok: true; leagueId: string } | { ok: false; message: string };

const LEAGUE_ID = /^\d{5,25}$/;
const LEAGUE_LINK = /sleeper\.(?:com|app)\/leagues?\/(\d{5,25})(?!\d)/i;
const USERNAME = /^[^\s/?#%\\]{1,50}$/;
/** Quotes, brackets and sentence punctuation pasted around an ID: "(1234567890)." → "1234567890". */
const WRAPPING = /^[\s"'`“”‘’(<[{]+|[\s"'`“”‘’)>\]}.,;:!?]+$/g;

export const SLEEPER_USERNAME_INVALID = "That doesn't look like a Sleeper username.";
/** Added to username errors: people often paste a league link or ID into the username box. */
export const SLEEPER_LEAGUE_ID_HINT = "Pasted a league link or ID? Switch to League ID above.";

export function parseSleeperLeagueInput(input: string): SleeperLeagueInput {
  const t = input.trim().replace(WRAPPING, "");
  if (!t) return { ok: false, message: "Enter your Sleeper league ID or paste the league link." };
  if (LEAGUE_ID.test(t)) return { ok: true, leagueId: t };
  const link = LEAGUE_LINK.exec(t);
  if (link?.[1]) return { ok: true, leagueId: link[1] };
  return { ok: false, message: "A Sleeper league ID is the long number in your league's web address (sleeper.com/leagues/…)." };
}

/**
 * The league ID when the text is a sleeper.com league link, e.g. one pasted into the username box.
 * A bare number isn't treated as a league ID here: Sleeper also accepts numeric user IDs.
 */
export function sleeperLeagueLinkId(input: string): string | undefined {
  const link = LEAGUE_LINK.exec(input.trim());
  return link?.[1];
}

/** A Sleeper username as typed (trimmed, without a leading @), or undefined when it can't be one. */
export function normalizeSleeperUsername(input: string): string | undefined {
  const t = input.trim().replace(/^@/, "");
  return USERNAME.test(t) ? t : undefined;
}

/** The Connect page's two ways in: a username (lists the user's leagues), or a league ID or link. */
export type SleeperInputMode = "username" | "league";

/** An error for the Sleeper form, and the field it's about (that field gets aria-invalid and points at it). */
export interface SleeperFormError {
  message: string;
  field?: "username" | "league";
}

/** An import error from the server in the form's terms: a username that isn't found hints at the League ID option. */
export function sleeperServerError(error: { code: string; message: string }, mode: SleeperInputMode): SleeperFormError {
  if (error.code === "USER_NOT_FOUND") {
    return mode === "username"
      ? { message: `${error.message} ${SLEEPER_LEAGUE_ID_HINT}`, field: "username" }
      : { message: "We couldn't find that Sleeper username. Check the spelling, or leave it blank: you can pick your team on the next page.", field: "username" };
  }
  if (error.code === "LEAGUE_NOT_FOUND" && mode === "league") return { message: error.message, field: "league" };
  return { message: error.message };
}
